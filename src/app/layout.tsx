import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import ClientLayout from '@/components/ClientLayout'
// Removed CentralizedVaultProvider import - smart contract functionality deleted

const inter = Inter({ subsets: ['latin'] })

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

export const metadata: Metadata = {
  title: 'Dexetera - DeFi Unlocked',
  description: 'Advanced DeFi Trading Platform',
  icons: {
    icon: [
      {
        url: '/Dexicon/LOGO-Dexetera-03.svg',
        type: 'image/svg+xml',
      },
      {
        url: '/Dexicon/LOGO-Dexetera-03.png',
        type: 'image/png',
        sizes: '32x32',
      },
    ],
    shortcut: '/Dexicon/LOGO-Dexetera-03.png',
    apple: '/Dexicon/LOGO-Dexetera-03@2x.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/*
          MetaMask in-app browser blocks automatic external-app opens on page load.
          Install a guard BEFORE any third-party scripts / React hydration.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
try{
if(typeof window==='undefined')return;
if(window.__DEXEXTRA_EXTERNAL_OPEN_GUARD_INSTALLED__)return;
window.__DEXEXTRA_EXTERNAL_OPEN_GUARD_INSTALLED__=true;

var ua=String((navigator&&navigator.userAgent)||'');
var mm=/metamask/i.test(ua)||!!(window.ethereum&&window.ethereum.isMetaMask);
if(!mm)return;

var ALLOW_MS=1200,lastG=0;
var mark=function(){lastG=Date.now()};
window.addEventListener('pointerdown',mark,true);
window.addEventListener('touchstart',mark,true);
window.addEventListener('keydown',mark,true);

var hasGesture=function(){
  try{var u=navigator&&navigator.userActivation;
    if(u&&typeof u.isActive==='boolean')return!!u.isActive}catch(e){}
  return(Date.now()-lastG)<=ALLOW_MS};

var origin=String(window.location&&window.location.origin)||'';
var resolve=function(r){try{var s=String(r==null?'':r).trim();
  if(!s)return null;return new URL(s,window.location.href)}catch(e){return null}};
var isHttp=function(p){return p==='http:'||p==='https:'};
var block=function(u){var x=resolve(u);if(!x)return false;
  if(!isHttp(x.protocol))return!hasGesture();
  if(origin&&x.origin!==origin)return!hasGesture();return false};

try{var _open=window.open&&window.open.bind(window);
  if(typeof _open==='function'){window.open=function(u,t,f){
    if(block(u))return null;return _open(u,t,f)}}}catch(e){}

try{var _assign=window.location.assign.bind(window.location);
  window.location.assign=function(u){if(block(u))return;return _assign(u)}}catch(e){}

try{var _replace=window.location.replace.bind(window.location);
  window.location.replace=function(u){if(block(u))return;return _replace(u)}}catch(e){}

try{var ld=Object.getOwnPropertyDescriptor(window,'location');
  if(!ld||!ld.set){ld=Object.getOwnPropertyDescriptor(Window.prototype,'location')}
  if(ld&&ld.set){var _locSet=ld.set;
    Object.defineProperty(window,'location',{get:ld.get,set:function(v){
      if(typeof v==='string'&&block(v))return;return _locSet.call(this,v)},
      configurable:true,enumerable:true})}}catch(e){}

}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${inter.className} ${spaceGrotesk.variable} ${GeistMono.variable}`}>
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  )
}
