from random import Random
from datetime import date,timedelta
from lupa.luajit21 import LuaRuntime
r=Random(77)
lua=LuaRuntime(unpack_returned_tuples=True)
lua.execute('package.path="projects/plugin/?.lua;"..package.path')
allocation=lua.eval('require("time.allocation")')
for _ in range(500):
    weights=[r.randrange(1,2**53) for _ in range(r.randrange(1,100))]
    seconds=r.randrange(0,2**53)
    total=sum(weights)
    rows=lua.table_from([lua.table_from({'date':str(date(2024,1,1)+timedelta(days=i)),'weight':w}) for i,w in enumerate(weights)])
    actual=allocation.weights(seconds,rows)
    pieces=[divmod(seconds*w,total) for w in weights]
    expected=[q for q,_ in pieces]
    left=seconds-sum(expected)
    for i in sorted(range(len(weights)),key=lambda i:(-pieces[i][1],i))[:left]: expected[i]+=1
    assert [actual[i+1].seconds for i in range(len(weights))]==expected
print('500 wide integer allocations match Python arbitrary-precision arithmetic')
