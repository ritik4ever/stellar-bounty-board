import { useEffect, useState } from "react";

interface BountyCountdownProps {
  deadlineAt: number;
  status: string;
}

export function BountyCountdown({ deadlineAt, status }: BountyCountdownProps) {
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    function calculateTimeLeft() {
      const now = Math.floor(Date.now() / 1000);
      const diff = deadlineAt - now;

      if (diff <= 0 || status === "expired") {
        setTimeLeft("Expired");
        setIsUrgent(false);
        return;
      }

      const days = Math.floor(diff / (24 * 3600));
      const hours = Math.floor((diff % (24 * 3600)) / 3600);
      const minutes = Math.floor((diff % 3600) / 60);

      let timeString = "";
      if (days > 0) timeString += `${days}d `;
      if (hours > 0 || days > 0) timeString += `${hours}h `;
      timeString += `${minutes}m remaining`;

      setTimeLeft(timeString);
      setIsUrgent(diff < 24 * 3600);
    }

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 60000);

    return () => clearInterval(timer);
  }, [deadlineAt, status]);

  if (status !== "open" && status !== "reserved" && status !== "expired") {
    return null;
  }

  return (
    <span 
      className={`countdown ${isUrgent ? "countdown--urgent" : ""}`}
      aria-live="polite"
    >
      {timeLeft}
    </span>
  );
}

export default BountyCountdown;
