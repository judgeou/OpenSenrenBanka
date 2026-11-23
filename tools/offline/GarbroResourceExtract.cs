using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using GameRes;
using GameRes.Formats.KiriKiri;

// Offline raw-resource preparation only. This program never dispatches game scripts.
[DataContract] class SchemeRow {
    [DataMember] public string title;
    [DataMember] public string cipher;
}
[DataContract] class ResourceRow {
    [DataMember] public int index;
    [DataMember] public string name;
    [DataMember] public long offset;
    [DataMember] public long storedBytes;
    [DataMember] public long expectedBytes;
    [DataMember] public string state;
    [DataMember] public string file;
    [DataMember] public long bytes;
    [DataMember] public string sha256;
    [DataMember] public string prefixHex;
    [DataMember] public string error;
}
[DataContract] class ResourceReport {
    [DataMember] public int schemaVersion = 1;
    [DataMember] public string format = "offline-xp3-resource-export-v1";
    [DataMember] public string source;
    [DataMember] public string scheme;
    [DataMember] public string cipher;
    [DataMember] public long sourceBytes;
    [DataMember] public string scope;
    [DataMember] public int exported;
    [DataMember] public int failed;
    [DataMember] public List<ResourceRow> entries = new List<ResourceRow>();
}

class SenrenResourceExtract {
    static ICrypt selected;
    static readonly HashSet<string> ScriptExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        ".ks", ".tjs", ".txt", ".asd", ".stand", ".asdtxt", ".dpt", ".sli"
    };

    static void Json<T>(string file, T value) {
        using (var output = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) {
            new DataContractJsonSerializer(typeof(T)).WriteObject(output, value);
            output.Flush(true);
        }
    }

    static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }

    static void Parameters(object sender, ParametersRequestEventArgs request) {
        if (!(sender is Xp3Opener) || selected == null) throw new InvalidOperationException("Unexpected archive parameter request");
        request.Options = new Xp3Options { Scheme = selected };
        request.InputResult = true;
    }

    static void LoadSchemes() {
        string data = Path.Combine(FormatCatalog.Instance.DataDirectory, "Formats.dat");
        using (var input = File.OpenRead(data)) FormatCatalog.Instance.DeserializeScheme(input);
    }

    static void Catalog(string file) {
        string keyword = new string(new char[] { (char)0x5343, (char)0x604b });
        var rows = Xp3Opener.KnownSchemes.Where(pair => pair.Key.Contains(keyword) ||
            pair.Key.IndexOf("Senren", StringComparison.OrdinalIgnoreCase) >= 0)
            .Select(pair => new SchemeRow { title = pair.Key, cipher = pair.Value.GetType().FullName }).ToList();
        Json(file, rows);
        Console.WriteLine("Wrote " + rows.Count + " matching scheme records: " + file);
    }

    static string AudioStem(string name) {
        string leaf = Path.GetFileName(name.Replace('/', Path.DirectorySeparatorChar));
        if (String.Equals(Path.GetExtension(leaf), ".sli", StringComparison.OrdinalIgnoreCase)) leaf = Path.GetFileNameWithoutExtension(leaf);
        string ext = Path.GetExtension(leaf).ToLowerInvariant();
        return ext == ".ogg" || ext == ".opus" || ext == ".wav" ? Path.GetFileNameWithoutExtension(leaf) : leaf;
    }

    static void Extract(string gameRoot, string archiveName, string scheme, string output, string scope) {
        HashSet<string> exactFiles = null;
        if (scope.StartsWith("file-names:", StringComparison.Ordinal)) {
            var list = Path.GetFullPath(scope.Substring("file-names:".Length));
            if (new FileInfo(list).Length > 1024 * 1024) throw new ArgumentException("File list too large");
            exactFiles = new HashSet<string>(File.ReadLines(list).Where(x => x.Length > 0).Select(x => x.Replace((char)92, '/')), StringComparer.OrdinalIgnoreCase);
            if (exactFiles.Count == 0 || exactFiles.Count > 10000) throw new ArgumentException("Invalid explicit file list");
            scope = "file-names";
        }
        HashSet<string> requiredAudio = null;
        if (scope.StartsWith("audio-names:", StringComparison.Ordinal)) {
            string list = Path.GetFullPath(scope.Substring("audio-names:".Length));
            if (new FileInfo(list).Length > 1024 * 1024) throw new ArgumentException("Audio list too large");
            requiredAudio = new HashSet<string>(File.ReadAllLines(list).Where(x => x.Length > 0), StringComparer.OrdinalIgnoreCase);
            if (requiredAudio.Count == 0 || requiredAudio.Count > 10000) throw new ArgumentException("Invalid audio list length");
            scope = "audio-names";
        }
        if (archiveName != Path.GetFileName(archiveName) || !archiveName.EndsWith(".xp3", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected an XP3 basename");
        if (scope != "scripts" && scope != "all" && scope != "r69-yos-voices" && requiredAudio == null && exactFiles == null) throw new ArgumentException("Unknown export scope");
        string root = Path.GetFullPath(gameRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string source = Path.Combine(root, archiveName);
        string destination = Path.GetFullPath(output).TrimEnd(Path.DirectorySeparatorChar);
        if ((destination + Path.DirectorySeparatorChar).StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Output must be outside game sources");
        if (Directory.Exists(destination) || File.Exists(destination)) throw new IOException("Output already exists");
        if (!Xp3Opener.KnownSchemes.TryGetValue(scheme, out selected)) throw new ArgumentException("Unknown exact scheme title");
        if (selected.GetType().FullName != "GameRes.Formats.KiriKiri.SenrenCxCrypt")
            throw new ArgumentException("Expected the Senren cipher profile");
        FormatCatalog.Instance.ParametersRequest += Parameters;
        var before = new FileInfo(source);
        long sourceBytes = before.Length; DateTime sourceWrite = before.LastWriteTimeUtc;
        Directory.CreateDirectory(destination);
        var report = new ResourceReport { source = source, scheme = scheme, cipher = selected.GetType().FullName,
            sourceBytes = sourceBytes, scope = scope };
        ArcView view = null;
        try {
            view = new ArcView(source);
            var opener = new Xp3Opener { ForceEncryptionQuery = true };
            var archive = opener.TryOpen(view);
            if (archive == null) throw new InvalidDataException("XP3 directory could not be decoded");
            view = null;
            using (archive) {
                int index = 0;
                foreach (var entry in archive.Dir.OrderBy(item => item.Offset)) {
                    var xp3 = entry as Xp3Entry;
                    var row = new ResourceRow { index = index++, name = entry.Name, offset = entry.Offset,
                        storedBytes = entry.Size, expectedBytes = xp3 == null ? entry.Size : xp3.UnpackedSize, state = "cataloged" };
                    report.entries.Add(row);
                    if (scope == "scripts" && !ScriptExtensions.Contains(Path.GetExtension(entry.Name))) continue;
                if (requiredAudio != null && !requiredAudio.Contains(AudioStem(entry.Name))) continue;
                if (exactFiles != null && !exactFiles.Contains(entry.Name.Replace((char)92, '/'))) continue;
                if (scope == "r69-yos-voices" && !(entry.Offset == 1327167015L && row.expectedBytes == 43348L) && !System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(entry.Name), @"^(len011_03[01](_ref)?|yas104_038).ogg(.sli)?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) continue;
                    try {
                        if (xp3 == null || !Object.ReferenceEquals(xp3.Cipher, selected))
                            throw new InvalidDataException("The archive selected a different cipher profile");
                        if (row.expectedBytes > 256L * 1024 * 1024) throw new InvalidDataException("Entry exceeds export budget");
                        row.file = row.index.ToString("D5") + ".bin";
                        using (var input = archive.OpenEntry(entry))
                        using (var data = new FileStream(Path.Combine(destination, row.file), FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read)) {
                            byte[] buffer = new byte[65536];
                            int count; long total = 0;
                            while ((count = input.Read(buffer, 0, buffer.Length)) > 0) {
                                total += count;
                                if (total > 256L * 1024 * 1024) throw new InvalidDataException("Decoded entry exceeds export budget");
                                data.Write(buffer, 0, count);
                            }
                            row.bytes = total; data.Flush(true); data.Position = 0;
                            byte[] prefix = new byte[Math.Min(16, (int)Math.Min(total, 16))];
                            data.Read(prefix, 0, prefix.Length); row.prefixHex = Hex(prefix); data.Position = 0;
                            using (var hash = SHA256.Create()) row.sha256 = Hex(hash.ComputeHash(data));
                        }
                        row.state = "exported"; report.exported++;
                    } catch (Exception error) { row.state = "unexported"; row.error = error.Message; report.failed++; }
                }
            }
            var after = new FileInfo(source);
            if (after.Length != sourceBytes || after.LastWriteTimeUtc != sourceWrite) throw new IOException("Source archive changed during export");
            Json(Path.Combine(destination, "manifest.json"), report);
            Console.WriteLine("Exported " + report.exported + " entries; failed=" + report.failed + "; directory=" + report.entries.Count);
            if (report.failed > 0) Environment.ExitCode = 1;
        } finally { if (view != null) view.Dispose(); }
    }

    static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            LoadSchemes();
            if (args.Length == 2 && args[0] == "schemes") Catalog(args[1]);
            else if (args.Length == 6 && args[0] == "extract") Extract(args[1], args[2], args[3], args[4], args[5]);
            else throw new ArgumentException("Usage: schemes <new-json> OR extract <game-root> <archive-name> <exact-title> <new-output> <scripts|all>");
            return Environment.ExitCode;
        } catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    }
}
