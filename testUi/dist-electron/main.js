"use strict";
const electron = require("electron");
const path = require("path");
const child_process = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const gotTheLock = electron.app.requestSingleInstanceLock();
if (!gotTheLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
let win = null;
let currentValidateProcess = null;
async function waitForServer(url, maxRetries = 30, delay = 1e3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const isReady = await new Promise((resolve) => {
        const req = http.get(url, (res) => {
          resolve(res.statusCode === 200);
          res.on("data", () => {
          });
          res.on("end", () => {
          });
        });
        req.on("error", () => resolve(false));
        req.setTimeout(1e3, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (isReady) {
        return true;
      }
    } catch (error) {
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return false;
}
async function createWindow() {
  if (win) {
    win.focus();
    return;
  }
  win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    },
    show: false
    // Ẩn window cho đến khi load xong
  });
  const serverReady = await waitForServer("http://localhost:5178");
  if (serverReady) {
    try {
      await win.loadURL("http://localhost:5178");
      win.show();
    } catch (error) {
      console.error("Failed to load URL:", error);
      win.show();
    }
  } else {
    console.error("Vite dev server is not ready after 30 seconds");
    win.show();
  }
  win.on("closed", () => {
    win = null;
  });
}
electron.app.whenReady().then(createWindow);
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("activate", () => {
  if (win === null) {
    createWindow();
  }
});
electron.ipcMain.handle("open-browser", async (_event, url) => {
  console.log("📂 Opening browser for URL:", url);
  await electron.shell.openExternal(url);
  return { success: true };
});
electron.ipcMain.handle("scan-page", async (_event, url) => {
  console.log(" IPC handler called with URL:", url);
  try {
    const result = await runScan(url);
    console.log(" IPC handler returning result, length:", result.length);
    console.log(" IPC handler result type:", Array.isArray(result) ? "Array" : typeof result);
    if (result.length > 0) {
      console.log("First result item:", JSON.stringify(result[0]));
    }
    return result;
  } catch (error) {
    console.error(" IPC handler error:", error);
    throw error;
  }
});
electron.ipcMain.handle("validate-page", async (_event, url, jsonObj) => {
  console.log("📥 IPC handler validate-page called with URL:", url);
  console.log("JSON object:", JSON.stringify(jsonObj).substring(0, 200));
  try {
    const result = await runValidate(url, jsonObj);
    console.log("✅ IPC handler validate-page returning result:", result);
    return result;
  } catch (error) {
    console.error("❌ IPC handler validate-page error:", error);
    throw error;
  }
});
function runValidate(url, jsonObj) {
  return new Promise(async (resolve, reject) => {
    const runnerPath = path.join(__dirname, "../electron/runners/validatePage.cjs");
    const jsonText = JSON.stringify(jsonObj);
    console.log("📌 Starting validate for URL:", url);
    console.log("📌 Runner path:", runnerPath);
    console.log("📌 JSON length:", jsonText.length);
    const tempFile = path.join(
      os.tmpdir(),
      `validate-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    try {
      fs.writeFileSync(tempFile, jsonText, "utf8");
      console.log("✅ JSON written to temp file:", tempFile);
    } catch (err2) {
      return reject(
        new Error(`Failed to write temp file: ${err2 instanceof Error ? err2.message : String(err2)}`)
      );
    }
    if (!fs.existsSync(tempFile)) {
      return reject(new Error(`Temp file does not exist: ${tempFile}`));
    }
    console.log("✅ Temp file size:", fs.statSync(tempFile).size, "bytes");
    if (!fs.existsSync(runnerPath)) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
      }
      return reject(new Error(`Runner file not found: ${runnerPath}`));
    }
    if (currentValidateProcess && !currentValidateProcess.killed) {
      console.log("⚠️ Killing previous validate process (PID:", currentValidateProcess.pid, ") to start new test...");
      try {
        currentValidateProcess.kill("SIGTERM");
        await new Promise((resolve2) => setTimeout(resolve2, 500));
      } catch (e) {
        console.log("⚠️ Error killing previous process:", e);
      }
    }
    const child = child_process.fork(runnerPath, [url, tempFile], {
      cwd: path.join(__dirname, "../.."),
      // Set về root project để tìm đúng node_modules
      env: {
        ...process.env
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    currentValidateProcess = child;
    console.log("✅ Process spawned, PID:", child.pid);
    if (!child.pid) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
      }
      return reject(new Error("Failed to spawn validate process (no PID)"));
    }
    let out = "";
    let err = "";
    let resultResolved = false;
    const timeout = setTimeout(() => {
      if (!resultResolved) {
        console.error("⚠️ Validate timeout, killing process...");
        try {
          child.kill("SIGTERM");
        } catch {
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
          }
        }, 1500);
        try {
          fs.unlinkSync(tempFile);
        } catch {
        }
        resultResolved = true;
        reject(new Error("Validate timeout after 90 seconds"));
      }
    }, 9e4);
    if (child.stdout) {
      child.stdout.on("data", (d) => {
        const chunk = d.toString();
        out += chunk;
        if (!resultResolved && out.trim()) {
          try {
            const trimmedOut = out.trim();
            if (trimmedOut.startsWith("{") && trimmedOut.includes('"pass"')) {
              const data = JSON.parse(trimmedOut);
              if (data.pass !== void 0) {
                console.log("✅ Got result from stdout, resolving immediately (process will continue in background)");
                clearTimeout(timeout);
                resultResolved = true;
                try {
                  fs.unlinkSync(tempFile);
                } catch {
                }
                if (currentValidateProcess === child) {
                  currentValidateProcess = null;
                }
                return resolve(data);
              }
            }
          } catch (e) {
          }
        }
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (d) => {
        const text = d.toString();
        err += text;
        console.error("Runner stderr:", text);
      });
    }
    child.on("error", (error) => {
      clearTimeout(timeout);
      try {
        fs.unlinkSync(tempFile);
      } catch {
      }
      reject(new Error(`Failed to start validate process: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      if (resultResolved) {
        console.log("Process closed (result already resolved from stdout)");
        return;
      }
      clearTimeout(timeout);
      console.log("=== Validate Exit Info ===");
      console.log("Exit code:", code);
      console.log("Signal:", signal);
      console.log("stdout length:", out.length);
      console.log("stderr length:", err.length);
      console.log("=========================");
      try {
        fs.unlinkSync(tempFile);
      } catch {
      }
      if (code !== 0) {
        resultResolved = true;
        console.error("=== Validate Runner Error Details ===");
        console.error("Exit code:", code);
        console.error("Signal:", signal);
        console.error("Stderr output:", err);
        console.error("Stdout output:", out.substring(0, 1e3));
        console.error("=====================================");
        if (err.includes("Executable doesn't exist") || err.includes("Browser not found") || err.includes("chromium")) {
          return reject(new Error("Playwright browser chưa được cài đặt. Vui lòng chạy: npx playwright install chromium"));
        }
        if (code === 4294967295 || code === -1) {
          const errorHint = err ? `Process bị kill hoặc crash. Chi tiết: ${err.substring(0, 500)}` : "Process bị kill hoặc crash. Có thể do: Playwright browser chưa được cài đặt, hoặc thiếu bộ nhớ, hoặc bị antivirus chặn.";
          return reject(new Error(errorHint));
        }
        const msg = (err || `Runner failed with code ${code}`).trim();
        return reject(new Error(msg));
      }
      if (!out.trim()) {
        resultResolved = true;
        return reject(new Error("No data returned from validate runner"));
      }
      try {
        const data = JSON.parse(out.trim());
        resultResolved = true;
        if (currentValidateProcess === child) {
          currentValidateProcess = null;
        }
        return resolve(data);
      } catch (e) {
        console.error("Invalid runner JSON output:", out.slice(0, 500));
        return reject(
          new Error(`Runner output is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
        );
      }
    });
  });
}
function runScan(url) {
  return new Promise((resolve, reject) => {
    const runnerPath = path.join(__dirname, "../electron/runners/scanPage.cjs");
    console.log("Starting scan for URL:", url);
    console.log("Runner path:", runnerPath);
    const child = child_process.fork(runnerPath, [url], {
      cwd: path.join(__dirname, "../.."),
      // Set về root project để tìm đúng node_modules
      env: {
        ...process.env
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    let out = "";
    let err = "";
    if (child.stdout) {
      child.stdout.on("data", (d) => {
        const text = d.toString();
        out += text;
        if (out.length < 500) {
          console.log("Runner stdout chunk:", text.substring(0, 100));
        }
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (d) => {
        const text = d.toString();
        err += text;
        console.log("Runner stderr (info):", text.trim());
      });
    }
    child.on("error", (error) => {
      console.error("❌ Failed to spawn runner:", error);
      clearTimeout(timeout);
      reject(new Error(`Failed to start scan process: ${error.message}`));
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Scan timeout after 60 seconds"));
    }, 6e4);
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      console.log("✅ Runner exited with code:", code, "signal:", signal);
      console.log("Runner stdout length:", out.length);
      console.log("Runner stderr length:", err.length);
      if (err) {
        console.log("Runner stderr content:", err);
      }
      if (code !== 0) {
        const errorMsg = err || `Runner failed with code ${code}`;
        console.error("Scan failed:", errorMsg);
        return reject(new Error(errorMsg));
      }
      if (!out.trim()) {
        console.error("No output from runner");
        return reject(new Error("No data returned from scan. Make sure the page has elements with id attributes."));
      }
      try {
        const trimmedOut = out.trim();
        console.log("Parsing JSON, length:", trimmedOut.length);
        console.log("First 200 chars:", trimmedOut.substring(0, 200));
        const data = JSON.parse(trimmedOut);
        console.log("✅ Scan successful, found", data.length, "items");
        console.log("Data type:", Array.isArray(data) ? "Array" : typeof data);
        if (data.length > 0) {
          console.log("First item:", JSON.stringify(data[0]));
        }
        if (!Array.isArray(data)) {
          console.error("❌ Data is not an array:", typeof data);
          return reject(new Error("Data returned is not an array"));
        }
        console.log("✅ Resolving with", data.length, "items");
        resolve(data);
      } catch (e) {
        console.error("❌ Failed to parse JSON:", e);
        console.error("Raw output length:", out.length);
        console.error("Raw output (first 500 chars):", out.substring(0, 500));
        reject(new Error(`Runner output is not valid JSON: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
    child.on("error", (error) => {
      console.error("Failed to spawn runner:", error);
      reject(new Error(`Failed to start scan process: ${error.message}`));
    });
  });
}
