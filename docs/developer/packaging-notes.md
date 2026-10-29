# Packaging Notes

## Tool Used
We use `electron-builder` (orchestrated via `electron-vite` build scripts) to create the Windows package.

## Commands
- **Test Build Output**: `npm run pack:win`
  - Compiles the app and creates an unpacked directory structure in `release/win-unpacked`. Good for testing local executables quickly.
- **Production Package**: `npm run dist:win`
  - Compiles the app and builds the actual Windows installer/Setup file.

## Configuration Details
- **electron-builder.yml**: Contains all packaging exclusions.
- **Excluded**:
  - `imports/`, `logs/`, `tmp/`, `debug/` directories to prevent massive builds and leaking operator data.
  - `.env.local` to prevent leaking developer API keys into production apps.

## Configuration Loading in Packaged Mode
When packaged, the application loads configuration via `dotenv.config()`. Since `.env.local` is intentionally stripped during build, the operator **must place their own `.env.local`** in the same directory as the installed `.exe` (or define environment variables on their OS).
The settings page will reflect if these values were successfully read.

## Known Limitations & Native Dependencies
- **Sharp / PDF-Lib**: We use native binaries to rasterize PDFs. `electron-builder` automatically handles `install-app-deps` natively, but cross-compiling (e.g. building the Windows app from a Mac) might require Docker or explicit architectural flags. It is heavily recommended to run `npm run dist:win` natively on a Windows machine or a Windows CI runner.

## Troubleshooting
### "Cannot create symbolic link : A required privilege is not held by the client"
When running `npm run dist:win`, `electron-builder` downloads tools like `winCodeSign` which may contain symbolic links (often macOS libraries bundled in the zip). Windows restricts creating symbolic links by default.
**Solution**:
1. Run your terminal (Command Prompt / PowerShell) as **Administrator**.
2. Or, enable **Developer Mode** in Windows Settings (`Settings > Update & Security > For developers > Developer Mode`) which grants symlink permissions to normal users.
