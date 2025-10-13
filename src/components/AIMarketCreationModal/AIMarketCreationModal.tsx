import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CodeBlock } from './CodeBlock';
import { CloseIcon, LearnMoreIcon } from './Icons';
import styles from './AIMarketCreationModal.module.css';

interface AIMarketCreationModalProps {
  title: string;
  description: string;
  codeExample?: {
    language: string;
    code: string;
  };
  onLearnMore?: () => void;
}

export const AIMarketCreationModal: React.FC<AIMarketCreationModalProps> = ({
  title,
  description,
  codeExample,
  onLearnMore
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleModal = () => setIsOpen(!isOpen);

  return (
    <div className={styles.aiMarketCreationModalContainer}>
      {/* Circular Trigger Button */}
      <motion.button
        className={styles.triggerButton}
        onClick={toggleModal}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        aria-label={isOpen ? "Close market creation modal" : "Open market creation modal"}
      >
        <span className={styles.buttonText}>AI</span>
      </motion.button>

      {/* Modal Content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className={styles.modalContent}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", damping: 30, stiffness: 350 }}
          >
            <div className={styles.modalHeader}>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <h2 className={styles.modalTitle}>{title}</h2>
              </div>
              <button 
                className={styles.closeButton}
                onClick={toggleModal}
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            <div className={styles.modalBody}>
              <p className={styles.description}>{description}</p>
              
              {codeExample && (
                <CodeBlock
                  language={codeExample.language}
                  code={codeExample.code}
                />
              )}
            </div>

            <div className={styles.modalFooter}>
              <button 
                className={styles.closeButton}
                onClick={toggleModal}
              >
                Close
              </button>
              {onLearnMore && (
                <button 
                  className={styles.learnMoreButton}
                  onClick={onLearnMore}
                >
                  Learn More
                  <LearnMoreIcon />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};