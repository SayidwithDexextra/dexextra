# Deposit Modal with Sliding Animation

This component implements a two-step deposit flow with smooth sliding animations between modals.

## Components

### 1. **DepositModal** (First Step)
- Select payment method and token
- Clicking "Continue" triggers slide-left animation

### 2. **DepositModalInput** (Second Step)  
- Enter deposit amount with percentage shortcuts (25%, 50%, 75%, Max)
- Clicking "Back" triggers slide-right animation

## Animation System

### **Forward Animation (Continue)**
```
First Modal: slides LEFT (-100%)
Second Modal: slides IN from RIGHT (100% → 0%)
```

### **Backward Animation (Back)**
```
Second Modal: slides RIGHT (100%)
First Modal: slides IN from LEFT (-100% → 0%)
```

### **CSS Classes**
- `.modalSlideOutLeft` - First modal sliding out left
- `.modalSlideInFromRight` - Second modal sliding in from right
- `.modalSlideOutRight` - Second modal sliding out right  
- `.modalSlideInFromLeft` - First modal sliding in from left

### **Timing**
- **Duration**: 150ms
- **Easing**: `ease-out`
- **State Management**: `isAnimating` prevents multiple clicks during animation

## Usage

```tsx
import { DepositModal } from '@/components/DepositModal'

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false)
  
  return (
    <DepositModal 
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
    />
  )
}
```

The animation is completely automatic - just use the original DepositModal component and the sliding animation will work seamlessly between the two steps. 