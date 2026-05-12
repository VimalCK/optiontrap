import React, { useEffect, useState, useMemo } from 'react';
import { TradesIcon } from '@/components/icons/Icons';
import { getSession } from '@/services/kiteAuth';
import {
  fetchNiftyOptions,
  getExpiries,
  buildOptionChain,
  OptionInstrument,
  OptionChainRow,
} from '@/services/optionChain';
import '@/styles/optionchain.css';

const Trades: React.FC = () => {
  const [options, setOptions] = useState<OptionInstrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');

  const session = getSession();

  useEffect(() => {
    if (session) {
      loadOptions();
    }
  }, []);

  const loadOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNiftyOptions();
      setOptions(data);
      const expiries = getExpiries(data);
      if (expiries.length > 0) {
        setSelectedExpiry(expiries[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load option chain');
    } finally {
      setLoading(false);
    }
  };

  const expiries = useMemo(() => getExpiries(options), [options]);
  const chain: OptionChainRow[] = useMemo(
    () => (selectedExpiry ? buildOptionChain(options, selectedExpiry) : []),
    [options, selectedExpiry],
  );

  // Find ATM strike (closest to middle of chain)
  const atmStrike = useMemo(() => {
    if (chain.length === 0) return 0;
    const mid = Math.floor(chain.length / 2);
    return chain[mid].strike;
  }, [chain]);

  // Show strikes around ATM (±15 strikes)
  const visibleChain = useMemo(() => {
    if (chain.length === 0) return [];
    const atmIndex = chain.findIndex((r) => r.strike === atmStrike);
    const start = Math.max(0, atmIndex - 15);
    const end = Math.min(chain.length, atmIndex + 16);
    return chain.slice(start, end);
  }, [chain, atmStrike]);

  if (!session) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-header__title">Trades</h1>
          <p className="page-header__subtitle">Execute and manage your option trades</p>
        </div>
        <div className="card">
          <div className="card__icon"><TradesIcon /></div>
          <h3 className="card__title">Not Connected</h3>
          <p className="card__description">Login to Kite Connect from the Profile page to view the option chain.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Trades</h1>
        <p className="page-header__subtitle">NIFTY Option Chain</p>
      </div>

      {/* Option Chain Card */}
      <div className="card option-chain-card">
        <div className="option-chain-header">
          <div>
            <div className="card__icon"><TradesIcon /></div>
            <h3 className="card__title">NIFTY Option Chain</h3>
          </div>
          {expiries.length > 0 && (
            <select
              className="option-chain-expiry-select"
              value={selectedExpiry}
              onChange={(e) => setSelectedExpiry(e.target.value)}
            >
              {expiries.map((exp) => (
                <option key={exp} value={exp}>
                  {new Date(exp).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </option>
              ))}
            </select>
          )}
        </div>

        {loading && (
          <div className="holdings-loading">
            <div className="redirect-spinner" />
            <p>Loading option chain...</p>
          </div>
        )}

        {error && (
          <div className="holdings-error" style={{ padding: 16 }}>
            <p>{error}</p>
            <button className="btn btn--primary" onClick={loadOptions} style={{ marginTop: 12 }}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && visibleChain.length > 0 && (
          <div className="option-chain-table-wrapper">
            <table className="option-chain-table">
              <thead>
                <tr>
                  <th colSpan={3} className="oc-header-ce">CALLS</th>
                  <th className="oc-header-strike">STRIKE</th>
                  <th colSpan={3} className="oc-header-pe">PUTS</th>
                </tr>
                <tr>
                  <th>LTP</th>
                  <th>Symbol</th>
                  <th>Lot</th>
                  <th></th>
                  <th>Lot</th>
                  <th>Symbol</th>
                  <th>LTP</th>
                </tr>
              </thead>
              <tbody>
                {visibleChain.map((row) => {
                  const isAtm = row.strike === atmStrike;
                  return (
                    <tr key={row.strike} className={isAtm ? 'oc-row--atm' : ''}>
                      <td className="oc-cell-ltp positive">
                        {row.ce ? row.ce.lastPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                      </td>
                      <td className="oc-cell-symbol">
                        {row.ce?.tradingsymbol || '-'}
                      </td>
                      <td className="oc-cell-lot">{row.ce?.lotSize || '-'}</td>
                      <td className="oc-cell-strike">{row.strike.toLocaleString('en-IN')}</td>
                      <td className="oc-cell-lot">{row.pe?.lotSize || '-'}</td>
                      <td className="oc-cell-symbol">
                        {row.pe?.tradingsymbol || '-'}
                      </td>
                      <td className="oc-cell-ltp negative">
                        {row.pe ? row.pe.lastPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && options.length === 0 && (
          <p className="card__description" style={{ marginTop: 16 }}>
            No option data available.
          </p>
        )}
      </div>
    </div>
  );
};

export default Trades;
