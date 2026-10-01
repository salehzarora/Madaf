# A private, unnamed Job Object retains ownership even after a parent exits.
# Assign this wrapper before spawning anything; children inherit the job, with
# no breakaway flag. Closing its only handle kills remaining owned descendants.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class E2eJob {
  [StructLayout(LayoutKind.Sequential)] public struct Basic {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Io {
    public ulong ReadOperations, WriteOperations, OtherOperations;
    public ulong ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Extended {
    public Basic Basic;
    public Io Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended limits, uint size);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static IntPtr OwnTree() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new InvalidOperationException("Owned job creation failed");
    Extended limits = new Extended();
    limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)) ||
        !AssignProcessToJobObject(job, GetCurrentProcess())) {
      CloseHandle(job);
      throw new InvalidOperationException("Owned job assignment failed");
    }
    return job;
  }
}
'@
  $spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:MADAF_E2E_OWNED_COMMAND)) | ConvertFrom-Json
  $ownedJob = [E2eJob]::OwnTree()
  & $spec.node $spec.proxy
  $commandExit = $LASTEXITCODE
  # Exiting closes the non-inheritable job handle; do not close it early since
  # this wrapper is itself a member and must first preserve the command code.
  exit $commandExit
} catch {
  Write-Error 'Owned Windows command wrapper failed'
  exit 1
}
