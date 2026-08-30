# tools/

Per-project helpers, shipped inside every project. One file per tool.

| tool | what it does |
|------|--------------|
| `projectpackager-windows.py` | The "Build" step. Freezes `playtest.py` into `<Project>.exe` (onefile) and bundles it with `index.html` + `<Project>.pak` (css/js/src packed) into a distributable folder. Run it from the project root: `python tools/projectpackager-windows.py`. |
