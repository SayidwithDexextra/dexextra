export interface PreviewTemplate {
  id: string;
  title: string;
  image: string;
  category?: string;
}

export interface MarketPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  productTitle: string;
  author: string;
  price: number;
  currency?: string;
  description: string;
  category?: string;
  templates: PreviewTemplate[];
  onGoToProduct: () => void;
}

export interface ModalAnimationProps {
  isOpen: boolean;
  children: React.ReactNode;
  onClose: () => void;
} 