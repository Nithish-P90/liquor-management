'use client'
import { useState } from 'react'

export default function AttendancePage() {
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null)

  async function markAttendance() {
    setScanning(true)
    setMessage(null)
    
    try {
      // Prompt Mantra RD Daemon Linux
      const xml = `<?xml version="1.0"?> <PidOptions ver="1.0"> <Opts fCount="1" fType="0" iCount="0" pCount="0" format="0" pidVer="2.0" timeout="10000" otp="" wadh="" posh=""/> </PidOptions>`;
      const res = await fetch('http://127.0.0.1:11100/rd/capture', {
        method: 'CAPTURE',
        headers: { 'Content-Type': 'text/xml' },
        body: xml
      });
      
      const template = await res.text();

      const verifyRes = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template })
      });
      
      const data = await verifyRes.json();
      
      if (!verifyRes.ok) throw new Error(data.error || 'Matching failed');
      
      // Play green beep
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      osc.type = 'sine'; osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
      osc.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 0.1);

      setMessage({ text: `Welcome ${data.staff}! Successfully marked ${data.type}.`, type: 'success' })
    } catch (e: any) {
      // Play red buzz
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, audioCtx.currentTime);
      osc.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 0.3);

      setMessage({ text: e.message || 'Scanner not found or Print unmatched', type: 'error' })
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-4 bg-slate-50">
      <div className="bg-white border rounded-2xl p-10 max-w-md w-full text-center shadow-sm">
        <h1 className="text-3xl font-black text-slate-800 mb-2">Biometric Registry</h1>
        <p className="text-slate-500 mb-10 text-sm">Place your thumb on the Mantra scanner to clock in or out.</p>

        <div className="relative flex justify-center mb-10">
          <div className={`absolute inset-0 bg-blue-100 rounded-full blur-xl scale-150 opacity-0 transition-opacity duration-500 ${scanning ? 'opacity-100 animate-pulse' : ''}`}></div>
          <button 
            onClick={markAttendance}
            disabled={scanning}
            className={`relative z-10 w-32 h-32 rounded-full border-4 flex items-center justify-center transition-all ${
              scanning 
                ? 'border-blue-400 bg-blue-50 text-blue-600 scale-105' 
                : 'border-slate-200 bg-white text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50'
            }`}
          >
            <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.092 2.027-.273 3M15 19l2-2m0 0l2-2m-2 2h-6"/>
            </svg>
          </button>
        </div>

        {message && (
          <div className={`p-4 rounded-xl text-sm font-semibold animate-in slide-in-from-bottom flex items-center justify-center gap-2 ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.type === 'success' ? '✅' : '❌'} {message.text}
          </div>
        )}

      </div>
    </div>
  )
}
