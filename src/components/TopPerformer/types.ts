export interface TopPerformerData {
  id: string;
  name: string;
  role: string;
  description?: string;
  avatarUrl: string;
  profileUrl?: string;
}

export interface TopPerformerCardProps {
  performer: TopPerformerData;
  onClick?: (performer: TopPerformerData) => void;
}

export interface TopPerformerCarouselProps {
  performers: TopPerformerData[];
  autoPlay?: boolean;
  autoPlayInterval?: number;
  showArrows?: boolean;
  showDots?: boolean;
  slidesToShow?: number;
  slidesToScroll?: number;
  infinite?: boolean;
  speed?: number;
  className?: string;
}

export interface TopPerformerDualCarouselProps {
  performers: TopPerformerData[];
  autoPlay?: boolean;
  autoPlayInterval?: number;
  speed?: number;
  className?: string;
  showArrows?: boolean;
} 