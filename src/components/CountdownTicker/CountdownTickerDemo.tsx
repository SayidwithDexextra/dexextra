'use client';

import React from 'react';
import CountdownTicker from './CountdownTicker';


const CountdownTickerDemo: React.FC = () => {
  // Create target dates for different demos
  const launchDate = new Date();
  launchDate.setDate(launchDate.getDate() + 7); // 7 days from now
  
  const saleEndDate = new Date();
  saleEndDate.setHours(saleEndDate.getHours() + 24); // 24 hours from now
  
  const eventDate = new Date();
  eventDate.setMinutes(eventDate.getMinutes() + 30); // 30 minutes from now

  const handleLaunchComplete = () => {
    console.log('Launch countdown completed!');
    alert('Launch Sale has started! 🚀');
  };

  const _handleSaleComplete = () => {
    console.log('Sale countdown completed!');
    alert('Sale has ended! Thank you for participating! 🎉');
  };

  const _handleEventComplete = () => {
    console.log('Event countdown completed!');
    alert('Event is starting now! 🎊');
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#0a0a0a', minHeight: '100vh' }}>
  
      
      {/* Full Banner Example */}
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ color: 'white', marginBottom: '20px' }}>Full Banner Layout</h2>
        <CountdownTicker
          targetDate={launchDate}
          title="Settlement Date"
          subtitle="The date of the settlement of the contract"
          onComplete={handleLaunchComplete}
          showBanner={true}
        />
      </div>

      {/* Banner with Different Content
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ color: 'white', marginBottom: '20px' }}>Flash Sale Banner</h2>
        <CountdownTicker
          targetDate={saleEndDate}
          title="Flash Sale"
          subtitle="Limited time offer - don't miss out!"
          onComplete={handleSaleComplete}
          showBanner={true}
        />
      </div> */}

      {/* Standalone Countdown
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ color: 'white', marginBottom: '20px' }}>Standalone Countdown</h2>
        <CountdownTicker
          targetDate={eventDate}
          onComplete={handleEventComplete}
          showBanner={false}
        />
      </div> */}

      {/* Custom Styled Example
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ color: 'white', marginBottom: '20px' }}>Custom Styled</h2>
        <CountdownTicker
          targetDate={new Date(Date.now() + 2 * 60 * 60 * 1000)} // 2 hours from now
          title="Special Event"
          subtitle="Join us for an exclusive preview!"
          onComplete={() => alert('Special event is starting!')}
          showBanner={true}
          className="custom-countdown"
        />
      </div> */}

    </div>
  );
};

export default CountdownTickerDemo; 