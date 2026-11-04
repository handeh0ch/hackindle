import json
import subprocess
from lupa.luajit21 import LuaRuntime
words=[''.join(chr(x) for x in range(0x410,0x430))+'Ё',''.join(chr(x) for x in range(0x430,0x450))+'ё','ПрИвЕт','ASCII-Ёж']
script='''let s="";for await(const c of process.stdin)s+=c;console.log(JSON.stringify(JSON.parse(s).map(x=>x.toLowerCase())));'''
expected=json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(words),text=True,encoding="utf-8",capture_output=True,check=True).stdout)
lua=LuaRuntime(unpack_returned_tuples=True)
lua.execute('package.path="plugin/?.lua;"..package.path')
reset=lua.eval('require("reset")'); null=lua.eval('require("wire_json").null')
actual=[json.loads(reset.vocabulary_identity(lua.table_from({'word':word,'language':null})))[0] for word in words]
assert actual==expected, (actual, expected)
print(f'{len(words)} supported Cyrillic/ASCII identity cases match JS lowercasing')
