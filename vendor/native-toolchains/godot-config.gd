extends SceneTree

func _initialize():
 var args = OS.get_cmdline_user_args()
 if args.size() != 2:
  quit(2)
  return
 if GDRESettings.load_project(PackedStringArray([args[0]])) != OK:
  quit(3)
  return
 if not GDRESettings.is_project_config_loaded():
  if GDRESettings.load_project_config() != OK:
   quit(4)
   return
 var result = GDRESettings.save_project_config(args[1])
 GDRESettings.unload_project()
 quit(0 if result == OK else 5)
