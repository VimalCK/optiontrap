import React from 'react';
import { PortfolioIcon } from '@/components/icons/Icons';

const Portfolio: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Portfolio</h1>
        <p className="page-header__subtitle">
          Manage and optimize your investment portfolio
        </p>
      </div>
      <div className="card-grid">
        <div className="card">
          <div className="card__icon">
            <PortfolioIcon />
          </div>
          <h3 className="card__title">Asset Breakdown</h3>
          <p className="card__description">
            Detailed view of all assets with current market values and weights.
          </p>
        </div>
        <div className="card">
          <div className="card__icon">
            <PortfolioIcon />
          </div>
          <h3 className="card__title">Rebalancing</h3>
          <p className="card__description">
            Smart suggestions to rebalance your portfolio based on target allocation.
          </p>
        </div>
        <div className="card">
          <div className="card__icon">
            <PortfolioIcon />
          </div>
          <h3 className="card__title">Risk Analysis</h3>
          <p className="card__description">
            Portfolio-level risk metrics including VaR, beta, and correlation matrix.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Portfolio;
