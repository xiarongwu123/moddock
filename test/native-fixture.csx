using UndertaleModLib.Compiler;
var group = new CodeImportGroup(Data);
group.QueueReplace("gml_Object_obj_player_Create_0", "health = 100; damage = 10; stamina = 30;");
group.QueueReplace("gml_Object_obj_player_Step_0", "if (keyboard_check(vk_space)) { stamina -= 1; }");
var result = group.Import();
if (!result.Successful) throw new System.Exception(result.PrintAllErrors(false));
System.IO.File.WriteAllText("fixture-compiled.txt", "ok");
