import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/kiosk-mode')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/kiosk-mode"!</div>
}
import React, { useState, useEffect } from 'react';

export default function KioskMode() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen w-screen bg-gray-900 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden font-sans text-white">
      
      {/* Left Side - Scanner Area */}
      <div className="flex-1 flex flex-col items-center justify-center relative p-8">
        <div className="absolute top-8 left-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            <span className="text-purple-500">Gym</span>phony
          </h1>
        </div>

        <h2 className="text-4xl font-bold mb-2 text-center">Scan your Entry Pass</h2>
        <p className="text-gray-400 text-lg mb-12 text-center">
          Open your member portal and hold the QR code to the camera
        </p>

        {/* Mock Camera Feed */}
        <div className="w-full max-w-100 aspect-square bg-gray-800 rounded-3xl border-4 border-gray-700 relative overflow-hidden shadow-2xl flex items-center justify-center">
          <div className="absolute inset-0 border-4 border-purple-500/30 rounded-3xl m-4"></div>
          {/* Scanning animation line */}
          <div className="absolute top-0 left-0 w-full h-1 bg-purple-500 shadow-[0_0_15px_#a855f7] animate-[scan_2s_ease-in-out_infinite]"></div>
          <p className="text-gray-500 font-medium">Camera Active</p>
        </div>
      </div>

      {/* Right Side - Status & Logs */}
      <div className="w-full lg:w-96 bg-gray-800 border-t lg:border-t-0 lg:border-l border-gray-700 p-8 flex flex-col">
        {/* Live Clock */}
        <div className="mb-12">
          <p className="text-5xl font-light tracking-wider mb-2">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-gray-400 font-medium">
            {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Live Scan Feed */}
        <div className="flex-1">
          <h3 className="text-sm uppercase tracking-widest text-gray-400 font-bold mb-6">Recent Check-ins</h3>
          
          <div className="space-y-4">
            {/* Success Scan */}
            <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-2xl flex items-center gap-4">
              <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center text-xl">
                ✅
              </div>
              <div>
                <p className="font-bold text-green-400">Access Granted</p>
                <p className="text-sm text-gray-300">Rahul Sharma • Pro Monthly</p>
              </div>
            </div>

            {/* Error Scan */}
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-4">
              <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center text-xl">
                ❌
              </div>
              <div>
                <p className="font-bold text-red-400">Access Denied</p>
                <p className="text-sm text-gray-300">Kabir Das • Plan Expired</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Exit Button for Owner */}
        <button 
          type="button"
          onClick={(e) => {
            e.preventDefault();
            window.location.href = '/dashboard';
          }}
          className="mt-auto w-full py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-xl text-sm font-semibold transition"
        >
          Exit Kiosk Mode
        </button>
      </div>

      {/* Add this to your global CSS for the scanning animation */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scan {
          0% { transform: translateY(0); }
          50% { transform: translateY(380px); }
          100% { transform: translateY(0); }
        }
      `}} />
    </div>
  );
}