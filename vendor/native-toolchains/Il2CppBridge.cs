using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Text.Json;
using Cpp2IL.Core;
using Cpp2IL.Core.Api;
using Cpp2IL.Core.InstructionSets;
using Cpp2IL.Core.OutputFormats;
using Cpp2IL.Core.ProcessingLayers;
using Il2CppInterop.Generator;
using Il2CppInterop.Generator.Runners;
using LibCpp2IL;
using Mono.Cecil;
using AssetRipper.Primitives;

internal static class Il2CppBridge
{
 static int Main(string[] args)
 {
  try
  {
   if (args.Length == 6 && args[0] == "generate")
   {
    InstructionSetRegistry.RegisterInstructionSet<X86InstructionSet>(DefaultInstructionSets.X86_32);
    InstructionSetRegistry.RegisterInstructionSet<X86InstructionSet>(DefaultInstructionSets.X86_64);
    LibCpp2IlBinaryRegistry.RegisterBuiltInBinarySupport();
    var version = UnityVersion.Parse(args[3]);
    Cpp2IlApi.InitializeLibCpp2Il(args[1], args[2], version, false);
    var layers = new List<Cpp2IlProcessingLayer> { new AttributeInjectorProcessingLayer() };
    foreach (var layer in layers) layer.PreProcess(Cpp2IlApi.CurrentAppContext, layers);
    foreach (var layer in layers) layer.Process(Cpp2IlApi.CurrentAppContext);
    var assemblies = new AsmResolverDllOutputFormatDefault().BuildAssemblies(Cpp2IlApi.CurrentAppContext);
    var options = new GeneratorOptions { Source = assemblies, OutputDir = args[5], UnityBaseLibsDir = args[4], GameAssemblyPath = null };
    Il2CppInteropGenerator.Create(options).AddInteropAssemblyGenerator().Run();
    ExportSignatures(args[5], Path.Combine(args[5], "interfaces.json"));
   }
   else if (args.Length == 3 && args[0] == "inspect") ExportSignatures(args[1], args[2]);
   else throw new Exception("Invalid host bridge arguments");
   return 0;
  }
  catch (Exception error) { Console.Error.WriteLine(error); return 1; }
 }
 static void ExportSignatures(string directory, string output)
 {
  var documents = new List<object>(); int total = 0;
  bool IsGameAssembly(string file) => !System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(file), @"^(System(?:\.|$)|Microsoft\.|Unity(?:Engine|Editor|\.)|Il2Cpp|mscorlib|netstandard|Mono\.|BepInEx|0Harmony)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
  foreach (var file in Directory.GetFiles(directory, "*.dll").OrderByDescending(IsGameAssembly).ThenByDescending(file => Path.GetFileName(file).StartsWith("Assembly-CSharp")))
  {
   if (documents.Count >= 48 || total > 150000) break;
   using var assembly = AssemblyDefinition.ReadAssembly(file);
   if (!IsGameAssembly(file) && !Path.GetFileName(file).StartsWith("UnityEngine")) continue;
   var text = new StringBuilder();
   foreach (var type in assembly.MainModule.Types)
   {
    if (!type.IsPublic || type.Name.StartsWith("<")) continue;
    var row = new StringBuilder();
    row.AppendLine("type " + type.FullName + " : " + type.BaseType?.FullName);
    foreach (var field in type.Fields.Where(field => field.IsPublic)) row.AppendLine("field " + (field.IsStatic ? "static " : "") + field.FieldType.FullName + " " + field.Name);
    foreach (var property in type.Properties.Where(property => property.GetMethod?.IsPublic == true)) row.AppendLine("property " + property.PropertyType.FullName + " " + property.Name + " {get;" + (property.SetMethod?.IsPublic == true ? "set;" : "") + "}");
    foreach (var method in type.Methods.Where(method => method.IsPublic && !method.IsConstructor && !method.IsGetter && !method.IsSetter))
     row.AppendLine("method " + (method.IsStatic ? "static " : "") + method.ReturnType.FullName + " " + method.Name + "(" + string.Join(", ", method.Parameters.Select(parameter => parameter.ParameterType.FullName + " " + parameter.Name)) + ")");
    if (text.Length + row.Length > 15000)
    {
     if (text.Length > 0) { documents.Add(new { path = "native/il2cpp/" + assembly.Name.Name + "-" + documents.Count + ".cs", text = text.ToString(), kind = "metadata-signatures" }); total += text.Length; text.Clear(); }
     if (row.Length > 15000 || documents.Count >= 48 || total > 150000) continue;
    }
    text.Append(row);
   }
   if (text.Length > 0 && documents.Count < 48 && total <= 150000) { documents.Add(new { path = "native/il2cpp/" + assembly.Name.Name + "-" + documents.Count + ".cs", text = text.ToString(), kind = "metadata-signatures" }); total += text.Length; }
  }
  File.WriteAllText(output, JsonSerializer.Serialize(documents));
 }
}
