using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using UndertaleModLib.Compiler;

// This bridge is shipped by the host. Generated content is GML data, never C# scripts.
var request = JsonConvert.DeserializeObject<Dictionary<string, object>>(File.ReadAllText("bridge-request.json"));
if (Data.Code == null || Data.Code.Count == 0)
    throw new Exception("此游戏没有可重编译的 GML 字节码（可能为 YYC）。");
if ((string)request["operation"] == "inspect")
{
    var rows = new List<object>();
    int total = 0;
    foreach (var entry in Data.Code.Where(c => c.ParentEntry == null)
        .OrderByDescending(c => Regex.IsMatch(c.Name.Content, "player|battle|combat|damage|weapon|inventory|health", RegexOptions.IgnoreCase)))
    {
        if (rows.Count >= 160) break;
        string source = null, error = null;
        if (rows.Count < 48 && total < 180000)
        {
            try { source = GetDecompiledText(entry); if (source.Length > 20000) source = null; }
            catch (Exception e) { error = e.Message.Substring(0, Math.Min(300, e.Message.Length)); }
        }
        if (source != null) total += source.Length;
        rows.Add(new { name = entry.Name.Content, source, error });
    }
    File.WriteAllText("bridge-result.json", JsonConvert.SerializeObject(new {
        version = new [] { Data.GeneralInfo.Major, Data.GeneralInfo.Minor, Data.GeneralInfo.Release, Data.GeneralInfo.Build },
        bytecode = Data.GeneralInfo.BytecodeVersion, entries = rows
    }));
}
else if ((string)request["operation"] == "build")
{
    var sources = JsonConvert.DeserializeObject<List<Dictionary<string,string>>>(request["sources"].ToString());
    var group = new CodeImportGroup(Data);
    foreach (var source in sources)
    {
        var entry = Data.Code.FirstOrDefault(c => c.Name.Content == source["entry"] && c.ParentEntry == null);
        if (entry == null) throw new Exception("未找到实际 GML 入口：" + source["entry"]);
        group.QueueReplace(entry, File.ReadAllText(source["file"]));
    }
    var result = group.Import();
    if (!result.Successful) throw new Exception(result.PrintAllErrors(false));
    File.WriteAllText("bridge-result.json", JsonConvert.SerializeObject(new { compiled = sources.Count }));
}
else throw new Exception("未知的宿主构建操作");
