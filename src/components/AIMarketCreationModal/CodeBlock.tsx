import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  language: string;
  code: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  return (
    <div className={styles.codeBlockWrapper}>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '20px',
          borderRadius: '8px',
          backgroundColor: '#1E1E1E',
          fontSize: '14px',
          lineHeight: '1.6'
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};
