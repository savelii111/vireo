/**
 * Security & Compliance Module Tests
 * 
 * Comprehensive test suite for all 10 classes in the security_pro module
 */

import {
  SSOProvider,
  TwoFactorAuth,
  APIKeyManager,
  IPWhitelist,
  AuditLogger,
  DataEncryption,
  GDPRCompliance,
  CCPACompliance,
  SOC2Compliance,
  ComplianceManager
} from '../src/security_pro.js';

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
  }
}

function expect(value) {
  return {
    toBe(expected) {
      if (value !== expected) {
        throw new Error(`Expected ${expected}, got ${value}`);
      }
    },
    toEqual(expected) {
      const actual = JSON.stringify(value);
      const expected_str = JSON.stringify(expected);
      if (actual !== expected_str) {
        throw new Error(`Expected ${expected_str}, got ${actual}`);
      }
    },
    toBeTruthy() {
      if (!value) {
        throw new Error(`Expected truthy, got ${value}`);
      }
    },
    toBeFalsy() {
      if (value) {
        throw new Error(`Expected falsy, got ${value}`);
      }
    },
    toContain(item) {
      if (Array.isArray(value)) {
        if (!value.includes(item)) {
          throw new Error(`Expected array to contain ${item}`);
        }
      } else if (typeof value === 'string') {
        if (!value.includes(item)) {
          throw new Error(`Expected string to contain ${item}`);
        }
      }
    },
    toHaveLength(length) {
      if (value.length !== length) {
        throw new Error(`Expected length ${length}, got ${value.length}`);
      }
    },
    toBeGreaterThan(expected) {
      if (!(value > expected)) {
        throw new Error(`Expected ${value} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected) {
      if (!(value >= expected)) {
        throw new Error(`Expected ${value} to be >= ${expected}`);
      }
    },
    toBeNull() {
      if (value !== null) {
        throw new Error(`Expected null, got ${value}`);
      }
    },
    not: {
      toBe(expected) {
        if (value === expected) {
          throw new Error(`Expected value to not be ${expected}`);
        }
      }
    },
    toThrow() {
      if (typeof value === 'function') {
        try {
          value();
          throw new Error('Expected function to throw');
        } catch (e) {
          if (e.message === 'Expected function to throw') {
            throw e;
          }
        }
      }
    }
  };
}

console.log('\n=== Security & Compliance Module Tests ===\n');

// ============================================
// SSOProvider Tests
// ============================================
console.log('--- SSOProvider Tests ---');

test('SSOProvider: should create instance', () => {
  const sso = new SSOProvider();
  expect(sso).toBeTruthy();
  expect(sso.getProviders()).toHaveLength(0);
});

test('SSOProvider: should configure SAML provider', () => {
  const sso = new SSOProvider();
  const result = sso.configureSAML({
    metadata_url: 'https://idp.example.com/metadata',
    entity_id: 'vireo-studio',
    certificate: 'MIIBkTCB+wIJAL...'
  });
  
  expect(result.status).toBe('Configured');
  expect(result.provider_id).toBeTruthy();
  expect(result.provider_id).toContain('saml_');
});

test('SSOProvider: should throw on missing SAML config', () => {
  const sso = new SSOProvider();
  
  try {
    sso.configureSAML({ metadata_url: 'https://example.com' });
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('Missing required');
  }
});

test('SSOProvider: should configure OAuth provider', () => {
  const sso = new SSOProvider();
  const result = sso.configureOAuth({
    client_id: 'client123',
    client_secret: 'secret456',
    provider: 'google'
  });
  
  expect(result.status).toBe('Configured');
  expect(result.provider_id).toContain('google');
});

test('SSOProvider: should throw on missing OAuth config', () => {
  const sso = new SSOProvider();
  
  try {
    sso.configureOAuth({ client_id: '123' });
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('Missing required');
  }
});

test('SSOProvider: should list providers', () => {
  const sso = new SSOProvider();
  sso.configureSAML({
    metadata_url: 'https://example.com',
    entity_id: 'test',
    certificate: 'cert'
  });
  sso.configureOAuth({
    client_id: '123',
    client_secret: '456',
    provider: 'github'
  });
  
  const providers = sso.getProviders();
  expect(providers).toHaveLength(2);
});

test('SSOProvider: should authenticate token', () => {
  const sso = new SSOProvider();
  const result = sso.authenticate('test-token-123');
  
  expect(result.success).toBe(true);
  expect(result.user).toBeTruthy();
  expect(result.user.id).toBeTruthy();
});

test('SSOProvider: should reject empty token', () => {
  const sso = new SSOProvider();
  const result = sso.authenticate('');
  
  expect(result.success).toBe(false);
  expect(result.error).toBeTruthy();
});

// ============================================
// TwoFactorAuth Tests
// ============================================
console.log('\n--- TwoFactorAuth Tests ---');

test('TwoFactorAuth: should create instance', () => {
  const tfa = new TwoFactorAuth();
  expect(tfa).toBeTruthy();
});

test('TwoFactorAuth: should enable 2FA', () => {
  const tfa = new TwoFactorAuth();
  const result = tfa.enable('user123');
  
  expect(result.secret).toBeTruthy();
  expect(result.qr_code).toBeTruthy();
  expect(result.qr_code).toContain('otpauth://totp');
});

test('TwoFactorAuth: should throw on missing userId', () => {
  const tfa = new TwoFactorAuth();
  
  try {
    tfa.enable('');
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('User ID is required');
  }
});

test('TwoFactorAuth: should verify valid code', () => {
  const tfa = new TwoFactorAuth();
  tfa.enable('user123');
  
  const result = tfa.verify('user123', '123456');
  expect(result).toBe(true);
});

test('TwoFactorAuth: should reject invalid code', () => {
  const tfa = new TwoFactorAuth();
  tfa.enable('user123');
  
  const result = tfa.verify('user123', '999999');
  expect(result).toBe(false);
});

test('TwoFactorAuth: should return false for missing params', () => {
  const tfa = new TwoFactorAuth();
  
  expect(tfa.verify('', '123456')).toBe(false);
  expect(tfa.verify('user123', '')).toBe(false);
});

test('TwoFactorAuth: should disable 2FA', () => {
  const tfa = new TwoFactorAuth();
  tfa.enable('user123');
  tfa.disable('user123');
  
  const status = tfa.getStatus('user123');
  expect(status.enabled).toBe(false);
});

test('TwoFactorAuth: should get status', () => {
  const tfa = new TwoFactorAuth();
  tfa.enable('user123');
  
  const status = tfa.getStatus('user123');
  expect(status.enabled).toBe(false);
  expect(status.last_used).toBeNull();
});

test('TwoFactorAuth: should update last_used on verify', () => {
  const tfa = new TwoFactorAuth();
  tfa.enable('user123');
  tfa.verify('user123', '123456');
  
  const status = tfa.getStatus('user123');
  expect(status.last_used).toBeTruthy();
});

// ============================================
// APIKeyManager Tests
// ============================================
console.log('\n--- APIKeyManager Tests ---');

test('APIKeyManager: should create instance', () => {
  const manager = new APIKeyManager();
  expect(manager).toBeTruthy();
});

test('APIKeyManager: should create API key', () => {
  const manager = new APIKeyManager();
  const key = manager.createKey('user123', { name: 'Test Key', permissions: ['read'] });
  
  expect(key.id).toBeTruthy();
  expect(key.key).toBeTruthy();
  expect(key.key).toContain('vsk_');
  expect(key.name).toBe('Test Key');
  expect(key.permissions).toContain('read');
});

test('APIKeyManager: should throw on missing userId', () => {
  const manager = new APIKeyManager();
  
  try {
    manager.createKey('');
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('User ID is required');
  }
});

test('APIKeyManager: should validate valid key', () => {
  const manager = new APIKeyManager();
  const created = manager.createKey('user123', { name: 'Test' });
  
  const result = manager.validateKey(created.key);
  expect(result.valid).toBe(true);
  expect(result.user_id).toBe('user123');
});

test('APIKeyManager: should reject invalid key', () => {
  const manager = new APIKeyManager();
  
  const result = manager.validateKey('invalid_key');
  expect(result.valid).toBe(false);
});

test('APIKeyManager: should reject revoked key', () => {
  const manager = new APIKeyManager();
  const created = manager.createKey('user123', { name: 'Test' });
  manager.revokeKey(created.id);
  
  const result = manager.validateKey(created.key);
  expect(result.valid).toBe(false);
  expect(result.error).toContain('revoked');
});

test('APIKeyManager: should rotate key', () => {
  const manager = new APIKeyManager();
  const original = manager.createKey('user123', { name: 'Test' });
  const rotated = manager.rotateKey(original.id);
  
  expect(rotated.key).not.toBe(original.key);
  expect(rotated.key).toContain('vsk_');
});

test('APIKeyManager: should list user keys', () => {
  const manager = new APIKeyManager();
  manager.createKey('user123', { name: 'Key 1' });
  manager.createKey('user123', { name: 'Key 2' });
  manager.createKey('user456', { name: 'Key 3' });
  
  const keys = manager.listKeys('user123');
  expect(keys).toHaveLength(2);
});

test('APIKeyManager: should revoke key', () => {
  const manager = new APIKeyManager();
  const key = manager.createKey('user123', { name: 'Test' });
  manager.revokeKey(key.id);
  
  const keys = manager.listKeys('user123');
  expect(keys).toHaveLength(0);
});

// ============================================
// IPWhitelist Tests
// ============================================
console.log('\n--- IPWhitelist Tests ---');

test('IPWhitelist: should create instance', () => {
  const whitelist = new IPWhitelist();
  expect(whitelist).toBeTruthy();
});

test('IPWhitelist: should add IP', () => {
  const whitelist = new IPWhitelist();
  whitelist.addIP('192.168.1.1', { description: 'Office' });
  
  const list = whitelist.list();
  expect(list).toHaveLength(1);
  expect(list[0].ip).toBe('192.168.1.1');
});

test('IPWhitelist: should throw on invalid IP', () => {
  const whitelist = new IPWhitelist();
  
  try {
    whitelist.addIP('invalid');
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('Invalid IP');
  }
});

test('IPWhitelist: should check allowed IP', () => {
  const whitelist = new IPWhitelist();
  whitelist.addIP('192.168.1.1');
  
  expect(whitelist.isAllowed('192.168.1.1')).toBe(true);
  expect(whitelist.isAllowed('10.0.0.1')).toBe(false);
});

test('IPWhitelist: should remove IP', () => {
  const whitelist = new IPWhitelist();
  whitelist.addIP('192.168.1.1');
  whitelist.removeIP('192.168.1.1');
  
  expect(whitelist.isAllowed('192.168.1.1')).toBe(false);
});

test('IPWhitelist: should clear all IPs', () => {
  const whitelist = new IPWhitelist();
  whitelist.addIP('192.168.1.1');
  whitelist.addIP('10.0.0.1');
  whitelist.clear();
  
  expect(whitelist.list()).toHaveLength(0);
});

test('IPWhitelist: should check CIDR range', () => {
  const whitelist = new IPWhitelist();
  whitelist.addIP('192.168.1.0/24');
  
  expect(whitelist.isAllowed('192.168.1.50')).toBe(true);
  expect(whitelist.isAllowed('192.168.2.50')).toBe(false);
});

test('IPWhitelist: should reject empty IP', () => {
  const whitelist = new IPWhitelist();
  expect(whitelist.isAllowed('')).toBe(false);
});

// ============================================
// AuditLogger Tests
// ============================================
console.log('\n--- AuditLogger Tests ---');

test('AuditLogger: should create instance', () => {
  const logger = new AuditLogger();
  expect(logger).toBeTruthy();
});

test('AuditLogger: should log event', () => {
  const logger = new AuditLogger();
  const entry = logger.log({
    user: 'user123',
    action: 'login',
    details: { ip: '192.168.1.1' }
  });
  
  expect(entry.id).toBeTruthy();
  expect(entry.user).toBe('user123');
  expect(entry.action).toBe('login');
  expect(entry.timestamp).toBeTruthy();
});

test('AuditLogger: should throw on missing params', () => {
  const logger = new AuditLogger();
  
  try {
    logger.log({ user: 'user123' });
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('action are required');
  }
});

test('AuditLogger: should query logs by user', () => {
  const logger = new AuditLogger();
  logger.log({ user: 'user1', action: 'login' });
  logger.log({ user: 'user2', action: 'logout' });
  logger.log({ user: 'user1', action: 'update' });
  
  const results = logger.query({ user: 'user1' });
  expect(results).toHaveLength(2);
});

test('AuditLogger: should query logs by action', () => {
  const logger = new AuditLogger();
  logger.log({ user: 'user1', action: 'login' });
  logger.log({ user: 'user2', action: 'login' });
  logger.log({ user: 'user1', action: 'logout' });
  
  const results = logger.query({ action: 'login' });
  expect(results).toHaveLength(2);
});

test('AuditLogger: should get recent logs', () => {
  const logger = new AuditLogger();
  for (let i = 0; i < 15; i++) {
    logger.log({ user: `user${i}`, action: 'test' });
  }
  
  const recent = logger.getRecent(5);
  expect(recent).toHaveLength(5);
});

test('AuditLogger: should export as JSON', () => {
  const logger = new AuditLogger();
  logger.log({ user: 'user1', action: 'test' });
  
  const exported = logger.export('json');
  expect(exported).toBeTruthy();
  expect(typeof exported).toBe('string');
});

test('AuditLogger: should export as CSV', () => {
  const logger = new AuditLogger();
  logger.log({ user: 'user1', action: 'test' });
  
  const exported = logger.export('csv');
  expect(exported).toContain('user');
  expect(exported).toContain('action');
});

// ============================================
// DataEncryption Tests
// ============================================
console.log('\n--- DataEncryption Tests ---');

test('DataEncryption: should create instance', () => {
  const encryption = new DataEncryption();
  expect(encryption).toBeTruthy();
});

test('DataEncryption: should encrypt data', () => {
  const encryption = new DataEncryption();
  const result = encryption.encrypt('Hello World');
  
  expect(result.encrypted).toBeTruthy();
  expect(result.iv).toBeTruthy();
  expect(result.algorithm).toBe('aes-256-gcm');
});

test('DataEncryption: should throw on empty data', () => {
  const encryption = new DataEncryption();
  
  try {
    encryption.encrypt('');
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('Data is required');
  }
});

test('DataEncryption: should throw on invalid algorithm', () => {
  const encryption = new DataEncryption();
  
  try {
    encryption.encrypt('test', { algorithm: 'invalid' });
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('Unsupported algorithm');
  }
});

test('DataEncryption: should decrypt data', () => {
  const encryption = new DataEncryption();
  const encrypted = encryption.encrypt('Hello World');
  const decrypted = encryption.decrypt(encrypted);
  
  expect(decrypted).toBe('Hello World');
});

test('DataEncryption: should get supported algorithms', () => {
  const encryption = new DataEncryption();
  const algorithms = encryption.getSupportedAlgorithms();
  
  expect(algorithms).toContain('aes-256-gcm');
  expect(algorithms).toContain('aes-256-cbc');
  expect(algorithms.length).toBeGreaterThanOrEqual(4);
});

test('DataEncryption: should generate and use key', () => {
  const encryption = new DataEncryption();
  const key = encryption.generateKey('key1');
  
  expect(key).toBeTruthy();
  expect(key.length).toBe(64); // 32 bytes = 64 hex chars
  
  const encrypted = encryption.encrypt('Secret data', { keyId: 'key1' });
  const decrypted = encryption.decrypt(encrypted);
  
  expect(decrypted).toBe('Secret data');
});

// ============================================
// GDPRCompliance Tests
// ============================================
console.log('\n--- GDPRCompliance Tests ---');

test('GDPRCompliance: should create instance', () => {
  const gdpr = new GDPRCompliance();
  expect(gdpr).toBeTruthy();
});

test('GDPRCompliance: should request data export', () => {
  const gdpr = new GDPRCompliance();
  const result = gdpr.requestDataExport('user123');
  
  expect(result.user_id).toBe('user123');
  expect(result.data).toBeTruthy();
  expect(result.data.profile).toBeTruthy();
});

test('GDPRCompliance: should throw on missing userId', () => {
  const gdpr = new GDPRCompliance();
  
  try {
    gdpr.requestDataExport('');
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('User ID is required');
  }
});

test('GDPRCompliance: should delete user data', () => {
  const gdpr = new GDPRCompliance();
  const result = gdpr.deleteUserData('user123');
  
  expect(result.deleted).toBe(true);
  expect(result.user_id).toBe('user123');
  expect(result.records_deleted).toBeGreaterThan(0);
});

test('GDPRCompliance: should get consent status', () => {
  const gdpr = new GDPRCompliance();
  const status = gdpr.getConsentStatus('user123');
  
  expect(status.user_id).toBe('user123');
  expect(status.marketing).toBe(false);
  expect(status.analytics).toBe(false);
});

test('GDPRCompliance: should update consent', () => {
  const gdpr = new GDPRCompliance();
  gdpr.updateConsent('user123', { marketing: true, analytics: true });
  
  const status = gdpr.getConsentStatus('user123');
  expect(status.marketing).toBe(true);
  expect(status.analytics).toBe(true);
  expect(status.updated_at).toBeTruthy();
});

test('GDPRCompliance: should anonymize data', () => {
  const gdpr = new GDPRCompliance();
  const result = gdpr.anonymizeData('user123');
  
  expect(result.anonymized).toBe(true);
  expect(result.fields_anonymized).toContain('email');
  expect(result.fields_anonymized).toContain('name');
});

// ============================================
// CCPACompliance Tests
// ============================================
console.log('\n--- CCPACompliance Tests ---');

test('CCPACompliance: should create instance', () => {
  const ccpa = new CCPACompliance();
  expect(ccpa).toBeTruthy();
});

test('CCPACompliance: should get rights info', () => {
  const ccpa = new CCPACompliance();
  const info = ccpa.getRightsInfo();
  
  expect(info.rights).toBeTruthy();
  expect(info.rights.length).toBeGreaterThanOrEqual(4);
  expect(info.categories_collected).toBeTruthy();
});

test('CCPACompliance: should opt out', () => {
  const ccpa = new CCPACompliance();
  const result = ccpa.optOut('user123');
  
  expect(result.opted_out).toBe(true);
  expect(result.user_id).toBe('user123');
});

test('CCPACompliance: should opt in', () => {
  const ccpa = new CCPACompliance();
  ccpa.optOut('user123');
  const result = ccpa.optIn('user123');
  
  expect(result.opted_out).toBe(false);
});

test('CCPACompliance: should get opt-out list', () => {
  const ccpa = new CCPACompliance();
  ccpa.optOut('user1');
  ccpa.optOut('user2');
  
  const list = ccpa.getOptOutList();
  expect(list).toHaveLength(2);
  expect(list).toContain('user1');
  expect(list).toContain('user2');
});

test('CCPACompliance: should remove from opt-out list', () => {
  const ccpa = new CCPACompliance();
  ccpa.optOut('user1');
  ccpa.optIn('user1');
  
  const list = ccpa.getOptOutList();
  expect(list).toHaveLength(0);
});

// ============================================
// SOC2Compliance Tests
// ============================================
console.log('\n--- SOC2Compliance Tests ---');

test('SOC2Compliance: should create instance', () => {
  const soc2 = new SOC2Compliance();
  expect(soc2).toBeTruthy();
});

test('SOC2Compliance: should get controls', () => {
  const soc2 = new SOC2Compliance();
  const controls = soc2.getControls();
  
  expect(controls.length).toBeGreaterThanOrEqual(10);
  expect(controls[0].id).toBeTruthy();
  expect(controls[0].name).toBeTruthy();
});

test('SOC2Compliance: should assess control', () => {
  const soc2 = new SOC2Compliance();
  const assessment = soc2.assessControl('CC6.1');
  
  expect(assessment.control_id).toBe('CC6.1');
  expect(assessment.score).toBeGreaterThan(0);
  expect(assessment.assessed_at).toBeTruthy();
});

test('SOC2Compliance: should throw on missing control ID', () => {
  const soc2 = new SOC2Compliance();
  
  try {
    soc2.assessControl('');
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('Control ID is required');
  }
});

test('SOC2Compliance: should get gap analysis', () => {
  const soc2 = new SOC2Compliance();
  const gaps = soc2.getGapAnalysis();
  
  // CC7.2 is partial, so should have at least one gap
  expect(gaps.length).toBeGreaterThanOrEqual(1);
  expect(gaps[0].control_id).toBeTruthy();
  expect(gaps[0].remediation_steps).toBeTruthy();
});

test('SOC2Compliance: should generate report', () => {
  const soc2 = new SOC2Compliance();
  const report = soc2.generateReport();
  
  expect(report.report_id).toBeTruthy();
  expect(report.summary).toBeTruthy();
  expect(report.summary.total_controls).toBeGreaterThanOrEqual(10);
  expect(report.summary.compliance_percentage).toBeGreaterThan(0);
});

// ============================================
// ComplianceManager Tests
// ============================================
console.log('\n--- ComplianceManager Tests ---');

test('ComplianceManager: should create instance', () => {
  const manager = new ComplianceManager();
  expect(manager).toBeTruthy();
});

test('ComplianceManager: should add policy', () => {
  const manager = new ComplianceManager();
  const policy = manager.addPolicy({
    name: 'Data Validation',
    rules: [
      { type: 'required_field', field: 'email' },
      { type: 'max_length', field: 'name', value: 100 }
    ],
    severity: 'high'
  });
  
  expect(policy.id).toBeTruthy();
  expect(policy.name).toBe('Data Validation');
  expect(policy.severity).toBe('high');
});

test('ComplianceManager: should throw on missing policy name', () => {
  const manager = new ComplianceManager();
  
  try {
    manager.addPolicy({ rules: [] });
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('Policy name is required');
  }
});

test('ComplianceManager: should throw on invalid severity', () => {
  const manager = new ComplianceManager();
  
  try {
    manager.addPolicy({ name: 'Test', severity: 'invalid' });
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e.message).toContain('Invalid severity');
  }
});

test('ComplianceManager: should evaluate compliant data', () => {
  const manager = new ComplianceManager();
  manager.addPolicy({
    name: 'User Data',
    rules: [
      { type: 'required_field', field: 'email' },
      { type: 'required_field', field: 'name' }
    ],
    severity: 'high'
  });
  
  const result = manager.evaluate({
    email: 'user@example.com',
    name: 'John Doe'
  });
  
  expect(result.passed).toBe(2);
  expect(result.failed).toBe(0);
  expect(result.violations).toHaveLength(0);
});

test('ComplianceManager: should detect violations', () => {
  const manager = new ComplianceManager();
  manager.addPolicy({
    name: 'User Data',
    rules: [
      { type: 'required_field', field: 'email' }
    ],
    severity: 'high'
  });
  
  const result = manager.evaluate({ name: 'John Doe' });
  
  expect(result.failed).toBe(1);
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0].severity).toBe('high');
});

test('ComplianceManager: should get policies', () => {
  const manager = new ComplianceManager();
  manager.addPolicy({ name: 'Policy 1', rules: [] });
  manager.addPolicy({ name: 'Policy 2', rules: [] });
  
  const policies = manager.getPolicies();
  expect(policies).toHaveLength(2);
});

test('ComplianceManager: should get violations', () => {
  const manager = new ComplianceManager();
  manager.addPolicy({
    name: 'Test',
    rules: [{ type: 'required_field', field: 'email' }],
    severity: 'critical'
  });
  
  manager.evaluate({});
  manager.evaluate({});
  
  const violations = manager.getViolations();
  expect(violations).toHaveLength(2);
});

// ============================================
// Integration Tests
// ============================================
console.log('\n--- Integration Tests ---');

test('Integration: SSO + 2FA flow', () => {
  const sso = new SSOProvider();
  const tfa = new TwoFactorAuth();
  
  // Configure SSO
  const ssoResult = sso.configureOAuth({
    client_id: 'app123',
    client_secret: 'secret456',
    provider: 'google'
  });
  expect(ssoResult.status).toBe('Configured');
  
  // Enable 2FA
  const tfaResult = tfa.enable('user123');
  expect(tfaResult.secret).toBeTruthy();
  
  // Verify 2FA
  const verified = tfa.verify('user123', '123456');
  expect(verified).toBe(true);
});

test('Integration: API Key + Audit logging', () => {
  const apiKeyManager = new APIKeyManager();
  const auditLogger = new AuditLogger();
  
  // Create key and log it
  const key = apiKeyManager.createKey('user123', { name: 'Production' });
  auditLogger.log({
    user: 'user123',
    action: 'api_key_created',
    details: { key_id: key.id }
  });
  
  // Validate and log
  apiKeyManager.validateKey(key.key);
  auditLogger.log({
    user: 'user123',
    action: 'api_key_used',
    details: { key_id: key.id }
  });
  
  const logs = auditLogger.query({ action: 'api_key_created' });
  expect(logs).toHaveLength(1);
});

test('Integration: Encryption + GDPR export', () => {
  const encryption = new DataEncryption();
  const gdpr = new GDPRCompliance();
  
  // Encrypt user data
  const sensitiveData = 'user@example.com';
  const encrypted = encryption.encrypt(sensitiveData);
  
  // Export user data
  const exportData = gdpr.requestDataExport('user123');
  expect(exportData.data).toBeTruthy();
  
  // Verify encryption works independently
  const decrypted = encryption.decrypt(encrypted);
  expect(decrypted).toBe(sensitiveData);
});

test('Integration: IP Whitelist + Compliance', () => {
  const whitelist = new IPWhitelist();
  const compliance = new ComplianceManager();
  
  // Add IP to whitelist
  whitelist.addIP('192.168.1.0/24', { description: 'Office network' });
  
  // Add policy requiring IP whitelist
  compliance.addPolicy({
    name: 'Network Security',
    rules: [
      { type: 'required_field', field: 'source_ip' }
    ],
    severity: 'critical'
  });
  
  // Evaluate request
  const result = compliance.evaluate({ source_ip: '192.168.1.50' });
  expect(result.passed).toBe(1);
  expect(whitelist.isAllowed('192.168.1.50')).toBe(true);
});

// ============================================
// Summary
// ============================================
console.log('\n=== Test Summary ===');
console.log(`Total: ${total}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`\n${failed === 0 ? '✓ All tests passed!' : `✗ ${failed} test(s) failed`}`);

process.exit(failed > 0 ? 1 : 0);
