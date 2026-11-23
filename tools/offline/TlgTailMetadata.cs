using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.Serialization;

[DataContract] class ImageSourceTag {
    [DataMember] public string keyHex; [DataMember] public string valueHex;
    [DataMember] public string key; [DataMember] public string value;
}
static class TlgTailMetadata {
    static string Hex(byte[] data, int start, int length) { return BitConverter.ToString(data, start, length).Replace("-", "").ToLowerInvariant(); }
    static string Text(byte[] data, int start, int length) {
        for (int i = start; i < start + length; ++i) if (data[i] < 32 || data[i] > 126) return "";
        return Encoding.ASCII.GetString(data, start, length);
    }
    static int Length(byte[] data, ref int cursor, int end) {
        int value = 0, digits = 0;
        while (cursor < end && data[cursor] >= 48 && data[cursor] <= 57) {
            value = checked(value * 10 + data[cursor++] - 48); digits++;
        }
        if (digits == 0 || cursor >= end || data[cursor++] != ':') throw new InvalidDataException("Invalid TLG tag length");
        return value;
    }
    public static List<ImageSourceTag> Parse(byte[] tail) {
        var result = new List<ImageSourceTag>();
        int start = -1;
        for (int i = tail.Length - 8; i >= 0; --i) if (tail[i] == 't' && tail[i+1] == 'a' && tail[i+2] == 'g' && tail[i+3] == 's') { start = i; break; }
        if (start < 0) return result;
        int length = BitConverter.ToInt32(tail, start + 4), cursor = start + 8;
        if (length < 0 || length > tail.Length - cursor) throw new InvalidDataException("TLG tag chunk exceeds tail");
        int end = cursor + length;
        while (cursor < end) {
            int keyLength = Length(tail, ref cursor, end), keyStart = cursor;
            if (keyLength > end - cursor - 1) throw new InvalidDataException("TLG tag key exceeds chunk");
            cursor += keyLength; if (tail[cursor++] != '=') throw new InvalidDataException("Missing TLG tag assignment");
            int valueLength = Length(tail, ref cursor, end), valueStart = cursor;
            if (valueLength > end - cursor - 1) throw new InvalidDataException("TLG tag value exceeds chunk");
            cursor += valueLength; if (tail[cursor++] != ',') throw new InvalidDataException("Missing TLG tag terminator");
            result.Add(new ImageSourceTag { keyHex = Hex(tail, keyStart, keyLength), valueHex = Hex(tail, valueStart, valueLength),
                key = Text(tail, keyStart, keyLength), value = Text(tail, valueStart, valueLength) });
        }
        return result;
    }
}
