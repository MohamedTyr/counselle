/**
 * ImageViewDialog — full-screen preview for an image attached to the composer.
 *
 * Renders nothing when `imageUrl` is null; otherwise shows the image centered in
 * a Radix dialog with a framer-motion scale/fade entrance. Extracted verbatim
 * from the lab composer; the upload channel is decorative for now (Phase 2+).
 */
import React from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogTitle } from './primitives';

interface ImageViewDialogProps {
  imageUrl: string | null;
  onClose: () => void;
}
export const ImageViewDialog: React.FC<ImageViewDialogProps> = ({ imageUrl, onClose }) => {
  if (!imageUrl) return null;
  return (
    <Dialog open={!!imageUrl} onOpenChange={onClose}>
      <DialogContent className="p-0 border-none bg-transparent shadow-none max-w-[90vw] md:max-w-[800px]">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative bg-[#1F2023] rounded-2xl overflow-hidden shadow-2xl"
        >
          <img src={imageUrl} alt="Full preview" className="w-full max-h-[80vh] object-contain rounded-2xl" />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};
