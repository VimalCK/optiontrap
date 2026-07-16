# Requirements Document

## Introduction

The OI Backtest Engine is a module for the OptionTrap trading application that tests hypotheses about Open Interest (OI) based trading signals against stored historical data. It pulls daily OI history from the existing `oi_history` SQLite table, applies user-defined trading rules (hypotheses), simulates trades, and computes statistical performance metrics. The goal is to help the user identify strategies with a quantifiable edge before risking real capital.

## Glossary

- **Backtest_Engine**: The server-side module that executes hypothesis rules against historical OI data and produces trade simulation results
- **Hypothesis**: A user-defined trading rule consisting of entry conditions based on OI changes, an entry action (buy/sell an option), and exit conditions (time-based or price-based)
- **Signal**: An event generated when historical data satisfies a hypothesis's entry conditions on a given date and strike
- **Simulated_Trade**: A record of entry and exit for a signal, including entry date, exit date, entry price, exit price, and P&L
- **Backtest_Run**: A single execution of a hypothesis against a date range, producing a set of simulated trades and aggregate metrics
- **Metrics_Calculator**: The component that computes aggregate statistics (win rate, total P&L, max drawdown, profit factor, average trade P&L) from a set of simulated trades
- **OI_Change_Percent**: The percentage change in open interest for a specific strike and option type between two consecutive trading days, calculated as ((OI_today - OI_yesterday) / OI_yesterday) * 100
- **OI_Wall**: A strike with disproportionately high open interest relative to adjacent strikes, acting as a potential support or resistance level
- **Results_UI**: The frontend React component that displays backtest configuration, triggers runs, and visualizes results

## Requirements

### Requirement 1: Hypothesis Definition

**User Story:** As a trader, I want to define trading hypotheses with configurable parameters, so that I can test different OI-based signal conditions against historical data.

#### Acceptance Criteria

1. THE Backtest_Engine SHALL accept a hypothesis definition containing: scrip name, option type (CE/PE), OI change direction (increase/decrease), OI change threshold percentage, entry action (buy/sell), holding period in trading days, and date range for the backtest
2. WHEN a hypothesis is submitted, THE Backtest_Engine SHALL validate that the OI change threshold is a positive number greater than zero
3. WHEN a hypothesis is submitted, THE Backtest_Engine SHALL validate that the holding period is an integer between 1 and 20 trading days
4. WHEN a hypothesis is submitted, THE Backtest_Engine SHALL validate that the date range falls within dates available in the oi_history table for the specified scrip
5. IF a hypothesis contains invalid parameters, THEN THE Backtest_Engine SHALL return a descriptive error message identifying each invalid field

### Requirement 2: Signal Detection

**User Story:** As a trader, I want the engine to scan historical data and detect all dates and strikes where my hypothesis conditions are met, so that I can see how frequently my signal fires.

#### Acceptance Criteria

1. WHEN a backtest is executed, THE Backtest_Engine SHALL compute OI_Change_Percent for each strike and option type between consecutive trading days within the specified date range
2. WHEN OI_Change_Percent for a strike exceeds the hypothesis threshold in the specified direction, THE Backtest_Engine SHALL generate a signal for that strike on the following trading day
3. THE Backtest_Engine SHALL exclude signals where the entry date falls outside the available data range (insufficient holding period data remaining)
4. WHEN multiple strikes satisfy the signal condition on the same day, THE Backtest_Engine SHALL generate separate signals for each qualifying strike

### Requirement 3: Trade Simulation

**User Story:** As a trader, I want the engine to simulate entering and exiting trades based on detected signals, so that I can evaluate hypothetical P&L without risking capital.

#### Acceptance Criteria

1. WHEN a signal is generated, THE Backtest_Engine SHALL record the entry price as the close price of the signaled option on the entry date
2. WHEN a signal is generated, THE Backtest_Engine SHALL record the exit price as the close price of the same option after the specified holding period in trading days
3. IF the option has no close price data on the exit date (expiry or missing data), THEN THE Backtest_Engine SHALL use the last available close price before the exit date as the exit price
4. THE Backtest_Engine SHALL compute per-trade P&L as (exit_price - entry_price) for buy actions and (entry_price - exit_price) for sell actions
5. THE Backtest_Engine SHALL record each simulated trade with: entry date, exit date, strike, option type, tradingsymbol, entry price, exit price, P&L in points, and signal OI change percentage

### Requirement 4: Performance Metrics Calculation

**User Story:** As a trader, I want to see aggregate performance statistics for a backtest run, so that I can determine whether a hypothesis has a statistical edge.

#### Acceptance Criteria

1. WHEN a backtest run completes, THE Metrics_Calculator SHALL compute the win rate as the percentage of simulated trades with positive P&L
2. WHEN a backtest run completes, THE Metrics_Calculator SHALL compute the total P&L as the sum of all per-trade P&L values in points
3. WHEN a backtest run completes, THE Metrics_Calculator SHALL compute the maximum drawdown as the largest peak-to-trough decline in cumulative P&L
4. WHEN a backtest run completes, THE Metrics_Calculator SHALL compute the profit factor as total gross profit divided by total gross loss (absolute value)
5. WHEN a backtest run completes, THE Metrics_Calculator SHALL compute the average trade P&L, total number of trades, number of winning trades, and number of losing trades
6. IF a backtest run produces zero simulated trades, THEN THE Metrics_Calculator SHALL return all metrics as zero and include a message indicating no signals were found

### Requirement 5: OI Wall Break Hypothesis

**User Story:** As a trader, I want to test whether OI wall breaks predict directional price movement, so that I can trade breakouts when heavy OI support or resistance levels are breached.

#### Acceptance Criteria

1. THE Backtest_Engine SHALL accept an OI wall break hypothesis containing: scrip name, option type, OI rank threshold (top N strikes by OI), OI drop percentage threshold, holding period, and date range
2. WHEN a strike ranks in the top N by OI on a given day and its OI drops by more than the specified percentage the next day, THE Backtest_Engine SHALL generate a wall break signal
3. WHEN a CE wall break signal is generated, THE Backtest_Engine SHALL simulate a buy on the underlying (spot) using spot_close prices for entry and exit
4. WHEN a PE wall break signal is generated, THE Backtest_Engine SHALL simulate a sell on the underlying (spot) using spot_close prices for entry and exit

### Requirement 6: Correlation Analysis

**User Story:** As a trader, I want to see the correlation between OI change magnitude and next-day price movement, so that I can understand whether larger OI changes predict larger moves.

#### Acceptance Criteria

1. WHEN a correlation analysis is requested, THE Backtest_Engine SHALL compute OI_Change_Percent and next-day option price change percentage for all strikes within the specified date range and option type
2. THE Backtest_Engine SHALL compute the Pearson correlation coefficient between OI_Change_Percent and next-day price change percentage
3. THE Backtest_Engine SHALL return the correlation coefficient, number of data points, and a scatter plot dataset (OI change vs price change pairs)

### Requirement 7: Backtest Results API

**User Story:** As a trader, I want to access backtest results through a REST API, so that the frontend can display and interact with the data.

#### Acceptance Criteria

1. WHEN a POST request is made to the backtest endpoint with a valid hypothesis, THE Backtest_Engine SHALL execute the backtest and return the full results in a single response
2. THE Backtest_Engine SHALL return results containing: hypothesis parameters, aggregate metrics, list of all simulated trades, and execution metadata (run duration, data points scanned)
3. IF the backtest takes longer than 30 seconds, THEN THE Backtest_Engine SHALL abort the run and return a timeout error with a suggestion to narrow the date range

### Requirement 8: Results Visualization

**User Story:** As a trader, I want to see backtest results in a visual dashboard, so that I can quickly evaluate whether a strategy has an edge.

#### Acceptance Criteria

1. THE Results_UI SHALL display a configuration form allowing the user to select scrip, option type, OI change direction, threshold percentage, entry action, holding period, and date range
2. WHEN backtest results are received, THE Results_UI SHALL display aggregate metrics (win rate, total P&L, max drawdown, profit factor, average P&L, trade count) in a summary panel
3. WHEN backtest results are received, THE Results_UI SHALL display a cumulative P&L chart over time showing the equity curve of the simulated trades
4. WHEN backtest results are received, THE Results_UI SHALL display a sortable table of all simulated trades with entry date, exit date, strike, entry price, exit price, and P&L
5. THE Results_UI SHALL highlight the win rate in green when it exceeds 60% and in red when it falls below 40%
6. WHEN the correlation analysis is selected, THE Results_UI SHALL display a scatter plot of OI change percentage versus next-day price change percentage with the correlation coefficient

### Requirement 9: Preset Hypotheses

**User Story:** As a trader, I want access to pre-built hypothesis templates based on common OI trading theories, so that I can quickly run backtests without manually configuring every parameter.

#### Acceptance Criteria

1. THE Results_UI SHALL provide preset hypothesis templates for: "OI Buildup Sell" (OI increase > 20%, sell option, 1-day hold), "OI Unwinding Buy" (OI decrease > 20%, buy option, 1-day hold), "OI Wall Break" (top 3 OI strike, OI drop > 30%, 2-day hold), and "Support Break" (PE OI drop > 25%, sell spot, 3-day hold)
2. WHEN a user selects a preset hypothesis, THE Results_UI SHALL populate the configuration form with the preset parameters
3. THE Results_UI SHALL allow the user to modify preset parameters before executing the backtest
