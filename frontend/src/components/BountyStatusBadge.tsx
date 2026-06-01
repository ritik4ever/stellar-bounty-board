import React from 'react';
import { Clock, CheckCircle, XCircle, AlertTriangle, DollarSign } from 'lucide-react';

interface BountyStatusBadgeProps {
  status: 'open' | 'in_progress' | 'completed' | 'cancelled' | 'expired';
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

const statusConfig = {
  open: {
    label: 'Open',
    color: 'bg-green-100 text-green-800 border-green-200',
    icon: DollarSign,
  },
  in_progress: {
    label: 'In Progress',
    color: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: Clock,
  },
  completed: {
    label: 'Completed',
    color: 'bg-gray-100 text-gray-800 border-gray-200',
    icon: CheckCircle,
  },
  cancelled: {
    label: 'Cancelled',
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: XCircle,
  },
  expired: {
    label: 'Expired',
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    icon: AlertTriangle,
  },
};

export default function BountyStatusBadge({ 
  status, 
  size = 'md', 
  showIcon = true 
}: BountyStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16,
  };

  return (
    <span className={`
      inline-flex items-center gap-1.5 rounded-full border font-medium
      ${config.color} ${sizeClasses[size]}
    `}>
      {showIcon && <Icon size={iconSizes[size]} />}
      {config.label}
    </span>
  );
}