import React from 'react';

type IconProps = {
  className?: string;
  title?: string;
};

const Svg = ({
  className,
  title,
  children,
}: React.PropsWithChildren<IconProps>) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden={title ? undefined : true}
    role={title ? 'img' : 'presentation'}
  >
    {title ? <title>{title}</title> : null}
    {children}
  </svg>
);

export const IconImage = ({ className, title }: IconProps) => (
  <Svg className={className} title={title}>
    <path
      d="M4.5 6.75C4.5 5.507 5.507 4.5 6.75 4.5H17.25C18.493 4.5 19.5 5.507 19.5 6.75V17.25C19.5 18.493 18.493 19.5 17.25 19.5H6.75C5.507 19.5 4.5 18.493 4.5 17.25V6.75Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M8 10.25C8.69 10.25 9.25 9.69 9.25 9C9.25 8.31 8.69 7.75 8 7.75C7.31 7.75 6.75 8.31 6.75 9C6.75 9.69 7.31 10.25 8 10.25Z"
      fill="currentColor"
    />
    <path
      d="M19.2 15.75L15.3 11.85C14.91 11.46 14.28 11.46 13.89 11.85L9.25 16.49L8.1 15.34C7.71 14.95 7.08 14.95 6.69 15.34L4.8 17.23"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconVideo = ({ className, title }: IconProps) => (
  <Svg className={className} title={title}>
    <path
      d="M5.5 7.5C5.5 6.395 6.395 5.5 7.5 5.5H14.5C15.605 5.5 16.5 6.395 16.5 7.5V16.5C16.5 17.605 15.605 18.5 14.5 18.5H7.5C6.395 18.5 5.5 17.605 5.5 16.5V7.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M16.5 10.5L19.2 8.95C19.71 8.66 20.35 9.03 20.35 9.62V14.38C20.35 14.97 19.71 15.34 19.2 15.05L16.5 13.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconCube = ({ className, title }: IconProps) => (
  <Svg className={className} title={title}>
    <path
      d="M12 2.75L19.25 6.75V17.25L12 21.25L4.75 17.25V6.75L12 2.75Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M12 21.25V12M12 12L19.25 6.75M12 12L4.75 6.75"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconNodes = ({ className, title }: IconProps) => (
  <Svg className={className} title={title}>
    <path
      d="M7.5 7.5H10.5V10.5H7.5V7.5ZM13.5 13.5H16.5V16.5H13.5V13.5ZM13.5 7.5H16.5V10.5H13.5V7.5ZM7.5 13.5H10.5V16.5H7.5V13.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M10.5 9H13.5M10.5 15H13.5M9 10.5V13.5M15 10.5V13.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </Svg>
);

export const IconSparkles = ({ className, title }: IconProps) => (
  <Svg className={className} title={title}>
    <path
      d="M12 2.75L13.6 7.2L18.05 8.8L13.6 10.4L12 14.85L10.4 10.4L5.95 8.8L10.4 7.2L12 2.75Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M19.25 13.25L19.9 15.05L21.7 15.7L19.9 16.35L19.25 18.15L18.6 16.35L16.8 15.7L18.6 15.05L19.25 13.25Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconSliders = ({ className, title }: IconProps) => (
  <Svg className={className} title={title}>
    <path
      d="M6 6.5H18M6 12H18M6 17.5H18"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M9.5 6.5V6.5M14.5 12V12M11.5 17.5V17.5"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
    />
  </Svg>
);

export const IconAspectRatio = ({ className, title }: IconProps) => (
  <Svg className={className} title={title}>
    <path
      d="M6.75 7.25H17.25C18.216 7.25 19 8.034 19 9V15C19 15.966 18.216 16.75 17.25 16.75H6.75C5.784 16.75 5 15.966 5 15V9C5 8.034 5.784 7.25 6.75 7.25Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M8.5 10.25H15.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </Svg>
);

export const IconShuffle = ({ className, title }: IconProps) => (
  <Svg className={className} title={title}>
    <path
      d="M16 4.5H19.5V8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4.5 7.5H8.25C9.1 7.5 9.9 7.9 10.4 8.6L13.6 13.4C14.1 14.1 14.9 14.5 15.75 14.5H19.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16 19.5H19.5V16"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4.5 16.5H8.25C9.1 16.5 9.9 16.1 10.4 15.4L11.6 13.6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.6 10.4L10.4 8.6C9.9 7.9 9.1 7.5 8.25 7.5H4.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M19.5 4.5L16 8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M19.5 19.5L16 16"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

