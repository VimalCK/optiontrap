import React from 'react';
import { WatchlistIcon } from '@/components/icons/Icons';

const Watchlist: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Watchlist</h1>
        <p className="page-header__subtitle">
          Monitor your favorite instruments and set alerts
        </p>
      </div>
      <div className="card-grid">
        <div className="card">
          <div className="card__icon">
            <WatchlistIcon />
          </div>
          <h3 className="card__title">Active Alerts</h3>
          <p className="card__description">
            Price and volume alerts for instruments on your watchlist.
          </p>
        </div>
        <div className="card">
          <div className="card__icon">
            <WatchlistIcon />
          </div>
          <h3 className="card__title">Screener</h3>
          <p className="card__description">
            Filter options by Greeks, volume, open interest, and more.
          </p>
        </div>
        <div className="card">
          <div className="card__icon">
            <WatchlistIcon />
          </div>
          <h3 className="card__title">Saved Lists</h3>
          <p className="card__description">
            Organize instruments into custom watchlists for quick access.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Watchlist;
