using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using GameRes;
using GameRes.Formats.KiriKiri;

// Offline lossless image preparation. Uses no game executable or renderer.
[DataContract] class InputImage {
    [DataMember] public string id; [DataMember] public string name; [DataMember] public string file;
    [DataMember] public bool isTlg; [DataMember] public string sha256; [DataMember] public long bytes;
}
[DataContract] class InputImages {
    [DataMember] public int schemaVersion; [DataMember] public string format;
    [DataMember] public List<InputImage> entries;
}
[DataContract] class OutputImage {
    [DataMember] public string id; [DataMember] public string name; [DataMember] public string file;
    [DataMember] public string sourceSha256; [DataMember] public string state; [DataMember] public string error;
    [DataMember] public long bytes; [DataMember] public string sha256; [DataMember] public uint width; [DataMember] public uint height;
    [DataMember] public int offsetX; [DataMember] public int offsetY; [DataMember] public int sourceOffsetX; [DataMember] public int sourceOffsetY;
    [DataMember] public int sourceBpp; [DataMember] public string pixelFormat;
    [DataMember] public List<ImageSourceTag> sourceTags = new List<ImageSourceTag>();
}
[DataContract] class ImageReport {
    [DataMember] public int schemaVersion = 1; [DataMember] public string format = "prepared-web-images-v1";
    [DataMember] public string source; [DataMember] public int converted; [DataMember] public int copied; [DataMember] public int failed;
    [DataMember] public List<OutputImage> entries = new List<OutputImage>();
}

class SenrenImagePrepare {
    static readonly MethodInfo RawTlg = typeof(TlgFormat).GetMethod("ReadTlg", BindingFlags.Instance | BindingFlags.NonPublic);
    static readonly MethodInfo ApplyTlgTags = typeof(TlgFormat).GetMethod("ApplyTags", BindingFlags.Instance | BindingFlags.NonPublic);
    static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
    static void Json<T>(string path, T value) {
        using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) {
            new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value); stream.Flush(true);
        }
    }
    static string OneLine(OutputImage row) {
        using (var stream = new MemoryStream()) {
            new DataContractJsonSerializer(typeof(OutputImage)).WriteObject(stream, row);
            return Encoding.UTF8.GetString(stream.ToArray());
        }
    }
    static string Within(string root, string relative) {
        string full = Path.GetFullPath(Path.Combine(root, relative));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Input escapes image root");
        return full;
    }

    // Invoke the decoder and tag combiner separately so missing differential bases
    // are reported as conversion errors rather than silently returning an overlay.
    static ImageData ReadStrictTlg(TlgFormat format, IBinaryStream stream, ImageMetaData meta, OutputImage output) {
        if (RawTlg == null || ApplyTlgTags == null) throw new InvalidOperationException("Unexpected GARbro TLG API");
        byte[] raw = (byte[])RawTlg.Invoke(format, new object[] { stream, meta });
        long tailBytes = stream.Length - stream.Position;
        if (tailBytes > 1024 * 1024) throw new InvalidDataException("TLG metadata tail exceeds budget");
        if (tailBytes > 8) {
            byte[] tail = stream.ReadBytes((int)tailBytes);
            output.sourceTags = TlgTailMetadata.Parse(tail);
            if (output.sourceTags.Any(tag => tag.keyHex == "01")) {
                if (!output.sourceTags.Any(tag => tag.keyHex == "02") || !output.sourceTags.Any(tag => tag.keyHex == "03"))
                    throw new InvalidDataException("Incomplete differential TLG coordinates");
                var combined = (ImageData)ApplyTlgTags.Invoke(format, new object[] { raw, meta, tail });
                if (combined != null) return combined;
            }
        }
        return ImageData.Create(meta, meta.BPP == 32 ? PixelFormats.Bgra32 : PixelFormats.Bgr32, null, raw, (int)meta.Width * 4);
    }

    [STAThread] static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            if (args.Length != 3) throw new ArgumentException("Expected game root, image input root, and new output directory");
            string game = Path.GetFullPath(args[0]).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string input = Path.GetFullPath(args[1]).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string output = Path.GetFullPath(args[2]).TrimEnd(Path.DirectorySeparatorChar);
            if ((output + Path.DirectorySeparatorChar).StartsWith(game, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Output is inside game sources");
            if (Directory.Exists(output) || File.Exists(output)) throw new IOException("Output already exists");
            InputImages inputs;
            using (var stream = File.OpenRead(Path.Combine(input, "manifest.json")))
                inputs = (InputImages)new DataContractJsonSerializer(typeof(InputImages)).ReadObject(stream);
            if (inputs.schemaVersion != 1 || inputs.format != "named-image-inputs-v1") throw new InvalidDataException("Unknown image input format");
            Directory.CreateDirectory(output);
            var report = new ImageReport { source = input };
            var tlg = new TlgFormat();
            using (var progress = new StreamWriter(new FileStream(Path.Combine(output, "progress.jsonl"), FileMode.CreateNew), new UTF8Encoding(false))) {
                foreach (var entry in inputs.entries) {
                    var row = new OutputImage { id = entry.id, name = entry.name, sourceSha256 = entry.sha256, state = "unprepared" };
                    report.entries.Add(row);
                    try {
                        if (String.IsNullOrEmpty(entry.id) || entry.id.Any(c => c < '0' || c > '9')) throw new InvalidDataException("Unsafe image id");
                        string source = Within(input, entry.file);
                        string extension = entry.isTlg ? ".png" : Path.GetExtension(entry.file).ToLowerInvariant();
                        if (!new[] { ".png", ".jpg", ".jpeg", ".bmp" }.Contains(extension)) throw new InvalidDataException("Unsupported web image extension");
                        row.file = entry.id + extension;
                        string destination = Path.Combine(output, row.file);
                        using (var binary = BinaryStream.FromFile(source)) {
                            if (entry.isTlg) {
                                var meta = tlg.ReadMetaData(binary);
                                if (meta == null) throw new InvalidDataException("Not a recognized TLG image");
                                if ((long)meta.Width * meta.Height > 64L * 1024 * 1024) throw new InvalidDataException("TLG pixel budget exceeded");
                                meta.FileName = source;
                                row.sourceBpp = meta.BPP;
                                var image = ReadStrictTlg(tlg, binary, meta, row);
                                row.sourceOffsetX = meta.OffsetX; row.sourceOffsetY = meta.OffsetY;
                                row.width = image.Width; row.height = image.Height; row.offsetX = image.OffsetX; row.offsetY = image.OffsetY;
                                row.pixelFormat = image.Bitmap.Format.ToString();
                                var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image.Bitmap));
                                using (var stream = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) {
                                    encoder.Save(stream); stream.Flush(true);
                                }
                                row.state = "converted"; report.converted++;
                            } else {
                                var decoder = BitmapDecoder.Create(binary.AsStream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
                                var frame = decoder.Frames[0];
                                row.width = (uint)frame.PixelWidth; row.height = (uint)frame.PixelHeight; row.sourceBpp = frame.Format.BitsPerPixel;
                                row.pixelFormat = frame.Format.ToString();
                                File.Copy(source, destination, false); row.state = "copied"; report.copied++;
                            }
                        }
                        row.bytes = new FileInfo(destination).Length;
                        using (var stream = File.OpenRead(destination)) using (var hash = SHA256.Create()) row.sha256 = Hex(hash.ComputeHash(stream));
                    } catch (Exception error) {
                        if (error is TargetInvocationException && error.InnerException != null) error = error.InnerException;
                        row.state = "unprepared"; row.error = error.Message; report.failed++;
                    }
                    progress.WriteLine(OneLine(row)); progress.Flush();
                    if (report.entries.Count % 100 == 0) Console.WriteLine("Image records: " + report.entries.Count + "/" + inputs.entries.Count);
                }
            }
            Json(Path.Combine(output, "manifest.json"), report);
            Console.WriteLine("Converted=" + report.converted + "; copied=" + report.copied + "; failed=" + report.failed);
            return report.failed == 0 ? 0 : 1;
        } catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    }
}
