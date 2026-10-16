import collections
import sqlite3
import sys


def connect(filename):
    connection = sqlite3.connect('file:' + filename + '?mode=ro', uri=True)
    assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert not connection.execute('PRAGMA foreign_key_check').fetchall()
    return connection


before, after = map(connect, sys.argv[1:3])
assert before.execute('SELECT Version FROM DatabaseSchemas WHERE Id=1').fetchone()[0] == 5
assert after.execute('SELECT Version FROM DatabaseSchemas WHERE Id=1').fetchone()[0] == 5
for (table,) in before.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
    quoted = '"' + table.replace('"', '""') + '"'
    original = collections.Counter(before.execute('SELECT * FROM ' + quoted))
    current = collections.Counter(after.execute('SELECT * FROM ' + quoted))
    assert original == current, table + ': rows changed during the write-closed deployment'
    print(table + ': all ' + str(sum(original.values())) + ' rows unchanged')
print('Database schema 5, all account rows, orders, memberships, features and integrity preserved.')
if len(sys.argv) == 5:
    mail_before, mail_after = map(connect, sys.argv[3:5])
    for (table,) in mail_before.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        quoted = '"' + table.replace('"', '""') + '"'
        original = collections.Counter(mail_before.execute('SELECT * FROM ' + quoted))
        current = collections.Counter(mail_after.execute('SELECT * FROM ' + quoted))
        assert not (original - current), table + ': mail history changed or disappeared'
    print('All historical mail records preserved; new background mail records may be appended.')
