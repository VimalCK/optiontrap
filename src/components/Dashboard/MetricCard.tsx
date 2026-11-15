import React from 'react';
import { ShimmerText } from '@/components/Shimmer/Shimmer';
import { Tone, type ToneId } from '@/utils/uiEnums';

const MetricCard: React.FC<{
  title: string;
  value: string;
  detail: string;
  tone?: ToneId;
  loading?: boolean;
  onClick?: () => void;
}> = ({ title, value, detail, tone = Tone.Neutral, loading = false, onClick }) => {
  const content = (
    <>
      <span className="dashboard-metric__label">{title}</span>
      <strong className={`dashboard-metric__value dashboard-tone--${tone.toLowerCase()}`}><ShimmerText loading={loading} width="4.5em">{value}</ShimmerText></strong>
      <span className="dashboard-metric__detail"><ShimmerText loading={loading} width="80%">{detail}</ShimmerText></span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="dashboard-metric dashboard-metric--clickable" onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <div className="dashboard-metric">
      {content}
    </div>
  );
};

export default MetricCard;
