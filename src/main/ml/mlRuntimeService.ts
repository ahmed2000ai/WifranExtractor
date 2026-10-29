import { exec } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import { error as logError, info as logInfo } from '../logging/logger'

const execAsync = promisify(exec)

export type LocalMlRuntimeStatus =
  | 'not_checked'
  | 'ready'
  | 'initializing'
  | 'unavailable'
  | 'error'

class MlRuntimeService {
  private status: LocalMlRuntimeStatus = 'not_checked'
  private mlDir: string

  constructor() {
    this.mlDir = path.join(process.cwd(), 'ml', 'offer-block-detector')
  }

  public getStatus(): LocalMlRuntimeStatus {
    return this.status
  }

  public getVenvPath(): string {
    return path.join(process.cwd(), '.ml-runtime')
  }

  public getPythonExecutable(): string {
    const isWin = process.platform === 'win32'
    return path.join(this.getVenvPath(), isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python')
  }

  public async checkRuntime(): Promise<LocalMlRuntimeStatus> {
    this.status = 'initializing'
    
    try {
      const pythonExe = this.getPythonExecutable()
      if (!fs.existsSync(pythonExe)) {
        logInfo('Managed Python runtime not found. Bootstrapping needed.')
        this.status = 'unavailable'
        return this.status
      }

      // Check if Torch is available in the managed environment
      const torchCheck = await execAsync(`"${pythonExe}" -c "import torch; print(torch.__version__)"`).catch(() => null)
      if (!torchCheck) {
        logInfo('PyTorch not found in managed environment. ML training unavailable.')
        this.status = 'unavailable'
        return this.status
      }

      this.status = 'ready'
    } catch (err: any) {
      logError(`ML Runtime check failed: ${err.message}`)
      this.status = 'error'
    }
    
    return this.status
  }

  public async bootstrapRuntime(): Promise<boolean> {
    try {
      const { annotationService } = require('../training/annotationService')
      annotationService.bootstrapEmptyDataset()
      
      const { stdout } = await execAsync('python --version').catch(() => ({ stdout: '' }))
      if (!stdout.toLowerCase().includes('python')) {
        logError('System Python not found. Cannot bootstrap managed environment.')
        return false
      }

      const venvPath = this.getVenvPath()
      if (!fs.existsSync(venvPath)) {
        logInfo('Creating managed Python virtual environment...')
        await execAsync(`python -m venv "${venvPath}"`)
      }

      const pythonExe = this.getPythonExecutable()
      const reqPath = path.join(this.mlDir, 'requirements.txt')
      if (fs.existsSync(reqPath)) {
        logInfo('Installing ML dependencies in managed environment...')
        await execAsync(`"${pythonExe}" -m pip install -r "${reqPath}"`)
      }

      const status = await this.checkRuntime()
      return status === 'ready'
    } catch (err: any) {
      logError(`Bootstrap failed: ${err.message}`)
      return false
    }
  }

  public getMlDir(): string {
    return this.mlDir
  }
}

export const mlRuntimeService = new MlRuntimeService()
