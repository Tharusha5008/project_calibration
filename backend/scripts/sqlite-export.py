"""Read a consistent SQLite snapshot without modifying the source database."""
import json
import pathlib
import sqlite3
import sys

tables = ['users','equipment_types','checks','requests','request_events','certificates','messages']
uri = pathlib.Path(sys.argv[1]).resolve().as_uri() + '?mode=ro'
with sqlite3.connect(uri, uri=True) as connection:
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA query_only=ON')
    connection.execute('BEGIN')
    if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('SQLite integrity check failed')
    if connection.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('SQLite foreign key check failed')
    data = {table: [dict(row) for row in connection.execute('SELECT * FROM ' + table + ' ORDER BY id')] for table in tables}
    print(json.dumps(data, allow_nan=False))
