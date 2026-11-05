import json
import subprocess
from lupa.luajit21 import LuaRuntime
script='''const words=['ΟΣ','ΟΣΑ','AΣ\\u0301','AΣ\\u0301A','İ','𐐀','ПрИвЕт']; for(let i=0;i<=0x10ffff;i++){if(i>=0xd800&&i<=0xdfff)continue; const c=String.fromCodePoint(i);if(c.toLowerCase()!==c)words.push(c)} const parts=['A','Σ','α','\\u0345','\\u0301',' ','𐐀','\\u200d','İ'];let seed=3;for(let i=0;i<2000;i++){let s='';for(let j=0;j<6;j++){seed=(seed*1664525+1013904223)>>>0;s+=parts[seed%parts.length]}words.push(s)} console.log(JSON.stringify([words,words.map(x=>x.toLowerCase())]));'''
words,expected=json.loads(subprocess.run(['node','--input-type=module','-e',script],text=True,encoding="utf-8",capture_output=True,check=True).stdout)
lua=LuaRuntime(unpack_returned_tuples=True)
lua.execute('package.path="plugin/?.lua;"..package.path')
reset=lua.eval('require("reset")'); null=lua.eval('require("wire_json").null')
actual=[json.loads(reset.vocabulary_identity(lua.table_from({'word':word,'language':null})))[0] for word in words]
for word, actual_word, expected_word in zip(words, actual, expected):
    assert actual_word==expected_word, (word, actual_word, expected_word)
print(f'{len(words)} Unicode identity cases match JS lowercasing')
