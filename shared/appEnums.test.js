import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  JobRunStatus,
  PriceAlertCondition,
  PriceAlertStatus,
  SubscriptionState,
  isFeedbackStatus,
  isFeedbackType,
  isPriceAlertCondition,
  priceAlertConditionLabel,
} from './appEnums.js';

describe('appEnums', () => {
  it('keeps the stored text values', () => {
    expect(Object.values(PriceAlertCondition)).toEqual(['Above', 'Below']);
    expect(Object.values(PriceAlertStatus)).toEqual(['Active', 'Triggered']);
    expect(FEEDBACK_TYPES).toEqual(['Bug', 'Feature', 'General', 'Subscription']);
    expect(FEEDBACK_STATUSES).toEqual(['Open', 'Reviewed', 'Resolved']);
    expect(Object.values(SubscriptionState)).toEqual(['Active', 'Cancelled', 'Expired', 'Inactive', 'Admin']);
    expect(Object.values(JobRunStatus)).toEqual(['Running', 'Done', 'Failed']);
  });

  it('recognises only its own values', () => {
    expect(isPriceAlertCondition(PriceAlertCondition.Below)).toBe(true);
    expect(isPriceAlertCondition('above')).toBe(false);
    expect(isFeedbackType('Feature')).toBe(true);
    expect(isFeedbackType('praise')).toBe(false);
    expect(isFeedbackStatus('Reviewed')).toBe(true);
    expect(isFeedbackStatus(undefined)).toBe(false);
  });

  it('labels a price alert condition', () => {
    expect(priceAlertConditionLabel(PriceAlertCondition.Above)).toBe('Above');
    expect(priceAlertConditionLabel('sideways')).toBe('sideways');
  });
});
