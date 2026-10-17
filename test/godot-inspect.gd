extends SceneTree
func _initialize():
 print("AUTOLOAD_SETTING=", ProjectSettings.get_setting("autoload/Moddock123abc"))
 var script = load("res://moddock/Moddock123abc/main.gdc")
 print("SCRIPT=", script)
 var node = script.new()
 print("METHODS=", node.get_method_list())
 quit()
