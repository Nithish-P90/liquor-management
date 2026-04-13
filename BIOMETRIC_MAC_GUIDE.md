# 🍶 Using the Biometric Emulator on Mac

Since the official CSD200 RD Service doesn't support MacOS, I have provided a **Mock Service** so you can test the system directly on your computer.

## 🚀 How to Start the Emulator

1.  Open your **Terminal** in VS Code (or your Mac's Terminal).
2.  Run the following command:
    ```bash
    node scripts/mock-rd-service.js
    ```
3.  You should see: `🍶 Mahavishnu Wines Biometric Mock Server Active`

## ✅ How to Test Attendance

1.  Open the **Attendance** page in your browser.
2.  Click the **Fingerprint Icon**.
3.  The app will think a real CSD200 is connected! It will "capture" a mock fingerprint and clock you in or out.

---

### ⚠️ Important Note for Store Launch
This emulator is for **development only**. When you deploy the software at the store:
1.  Connect the **Real CSD200** to a **Windows 10/11 PC**.
2.  Install the **Precision RD Service** from the manufacturer's website.
3.  The software will automatically switch from using this mock to using the real device.
