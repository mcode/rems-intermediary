import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * HookSession Schema
 * 
 * Stores information about CDS Hook calls to enable proxying Communication resources
 * from REMS Admin back to the originating EHR.
 * 
 */

const HookSessionSchema = new Schema({
  // Hook identification
  hookInstance: {
    type: String,
    required: true,
    index: true,
    description: 'UUID from the CDS Hook hookInstance field'
  },
  
  hookType: {
    type: String,
    required: true,
    enum: ['order-sign', 'order-select', 'patient-view', 'encounter-start'],
    description: 'Type of CDS Hook that was called'
  },
  
  // EHR information  
  ehrFhirServer: {
    type: String,
    required: true,
    description: 'Original EHR FHIR base URL (e.g., https://ehr.example.com/fhir/r4)'
  },
  
  ehrAuthorization: {
    access_token: {
      type: String,
      required: false,
      description: 'OAuth access token for the EHR'
    },
    token_type: {
      type: String,
      required: false,
      default: 'Bearer',
      description: 'Token type (typically Bearer)'
    },
    expires_in: {
      type: Number,
      required: false,
      description: 'Token expiration in seconds'
    },
    scope: {
      type: String,
      required: false,
      description: 'OAuth scopes granted'
    },
    subject: {
      type: String,
      required: false,
      description: 'Subject/client ID for the token'
    }
  },
  
  // Patient context
  patientId: {
    type: String,
    required: true,
    index: true,
    description: 'Patient ID from hook context'
  },
  
  // Optional encounter context  
  encounterId: {
    type: String,
    required: false,
    index: true,
    description: 'Encounter ID from hook context if present'
  },
  
  // Practitioner context
  userId: {
    type: String,
    required: false,
    description: 'User/Practitioner ID from hook context'
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
    description: 'When this session was created'
  },
  
  expiresAt: {
    type: Date,
    required: true,
    index: true,
    description: 'When this session expires'
  },
  
  // Tracking
  lastAccessedAt: {
    type: Date,
    default: Date.now,
    description: 'Last time this session was accessed'
  },
  
  communicationsSent: {
    type: Number,
    default: 0,
    description: 'Number of Communication resources proxied using this session'
  }
});

// Index for efficient lookups
HookSessionSchema.index({ patientId: 1, hookInstance: 1 });
HookSessionSchema.index({ expiresAt: 1 }); 

// Static method to create a session from a CDS Hook
HookSessionSchema.statics.createFromHook = async function(hook: any, ttlHours: number = 24) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  
  const session = new this({
    hookInstance: hook.hookInstance,
    hookType: hook.hook,
    ehrFhirServer: hook.fhirServer?.toString(),
    ehrAuthorization: hook.fhirAuthorization,
    patientId: hook.context.patientId,
    encounterId: hook.context.encounterId,
    userId: hook.context.userId,
    createdAt: now,
    expiresAt: expiresAt,
    lastAccessedAt: now
  });
  
  await session.save();
  console.log(`✅ Created HookSession: ${session._id} for patient ${session.patientId}`);
  return session;
};

// Static method to find an active session for a patient
HookSessionSchema.statics.findActiveSession = async function(patientId: string) {
  const now = new Date();
  
  // Find the most recent non-expired session for this patient
  const session = await this.findOne({
    patientId: patientId,
    expiresAt: { $gt: now }
  }).sort({ createdAt: -1 }); // Most recent first
  
  if (session) {
    // Update last accessed time
    session.lastAccessedAt = now;
    await session.save();
  }
  
  return session;
};

// Static method to cleanup expired sessions
HookSessionSchema.statics.cleanupExpired = async function() {
  const now = new Date();
  const result = await this.deleteMany({ expiresAt: { $lt: now } });
  if (result.deletedCount > 0) {
    console.log(`🧹 Cleaned up ${result.deletedCount} expired HookSession(s)`);
  }
  return result.deletedCount;
};

// Instance method to increment communication counter
HookSessionSchema.methods.incrementCommunications = async function() {
  this.communicationsSent += 1;
  this.lastAccessedAt = new Date();
  await this.save();
};

export const HookSession = mongoose.model('HookSession', HookSessionSchema);