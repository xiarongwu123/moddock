extends SceneTree
func _initialize():
 var result = ProjectSettings.save_custom("res://project.binary")
 quit(0 if result == OK else 1)
