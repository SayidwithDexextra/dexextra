'use client';

import React, { useState } from 'react';

interface Message {
  id: string;
  user: string;
  content: string;
  time: string;
  avatar: string;
}

// Mock message data
const mockMessages: Message[] = [
  { 
    id: '1', 
    user: 'Sayid', 
    content: 'This is Awesome I Love Dexextra', 
    time: '15m', 
    avatar: '👑' 
  },
  { 
    id: '2', 
    user: 'crypto_bull', 
    content: 'ETH looking strong today! 🚀', 
    time: '2m', 
    avatar: '🐂' 
  },
  { 
    id: '3', 
    user: 'trader_joe', 
    content: 'Just bought the dip at $2850', 
    time: '5m', 
    avatar: '📈' 
  },
  { 
    id: '4', 
    user: 'diamond_hands', 
    content: 'HODL forever! 💎', 
    time: '8m', 
    avatar: '💎' 
  },
  { 
    id: '5', 
    user: 'eth_whale', 
    content: 'Major resistance at $2900', 
    time: '12m', 
    avatar: '🐋' 
  },
  { 
    id: '6', 
    user: 'defi_king', 
    content: 'ETH 2.0 staking rewards looking good', 
    time: '15m', 
    avatar: '👑' 
  },
  { 
    id: '7', 
    user: 'Pizza Steve', 
    content: 'This is Awesome I Love Dexextra', 
    time: '15m', 
    avatar: '🍕' 
  }
];

export default function ThreadPanel() {
  const [message, setMessage] = useState('');
  const [messages] = useState(mockMessages);

  const handleSendMessage = () => {
    if (message.trim()) {
      // In a real app, this would send the message to the backend
      console.log('Sending message:', message);
      setMessage('');
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">Community Chat</h3>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm text-zinc-400">247 online</span>
          </div>
        </div>
        
        {/* Messages Container */}
        <div className="max-h-[200px] overflow-y-auto mb-3 space-y-2 thread-panel-scroll">
          {messages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-2">
              <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs">
                {msg.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{msg.user}</span>
                  <span className="text-xs text-zinc-400">{msg.time}</span>
                </div>
                <p className="text-sm text-zinc-300 break-words">{msg.content}</p>
              </div>
            </div>
          ))}
        </div>
        
        {/* Message Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-600"
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          />
          <button
            onClick={handleSendMessage}
            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm text-white transition-colors"
          >
            Send
          </button>
        </div>
      </div>
      
      {/* Custom scrollbar styles */}
      <style jsx>{`
        /* Webkit scrollbar styles */
        :global(.thread-panel-scroll::-webkit-scrollbar) {
          width: 2px;
        }
        
        :global(.thread-panel-scroll::-webkit-scrollbar-track) {
          background: transparent;
        }
        
        :global(.thread-panel-scroll::-webkit-scrollbar-thumb) {
          background: #22C55E;
          border-radius: 2px;
        }
        
        :global(.thread-panel-scroll::-webkit-scrollbar-thumb:hover) {
          background: #16A34A;
        }
        
        /* Firefox scrollbar styles */
        :global(.thread-panel-scroll) {
          scrollbar-width: thin;
          scrollbar-color: #22C55E transparent;
        }
      `}</style>
    </div>
  );
} 