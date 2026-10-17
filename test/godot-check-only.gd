extends Node
static var canary = _write_canary()
static func _write_canary():
 var file = FileAccess.open(OS.get_environment("MODDOCK_CHECK_ONLY_CANARY"), FileAccess.WRITE)
 if file:
  file.store_string("unexpected execution")
 return 1
