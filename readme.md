# Electron QA

Update the [electron-updater](https://github.com/electron-userland/electron-builder) is a simple but very risky process,
because maybe the auto updater would not work in the next release.
If updating the updater have to release 2 versions of the app to be sure the updater works.

Example:

| Application version | Electron updater version | result |
| :-----------------: | :----------------------: |:-----: |
|        1.0.0        |          x.x.x           | need to release next version to test |
|        1.0.1        |          x.x.x           | can test 1.0.0 => success/failed |
|        1.0.2        |         x.x.x+1          | can test the x.x.x electron-updater version can update the app to 1.0.2, but can not test the x.x.x+1 can update the app to the next version |

