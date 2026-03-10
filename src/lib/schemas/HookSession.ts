import mongoose, { Document, Model } from 'mongoose';
const { Schema } = mongoose;

// Interface for the document
export interface IHookSession extends Document {
  hookInstance: string;
  hookType: 'order-sign' | 'order-select' | 'patient-view' | 'encounter-start';
  ehrFhirServer: string;
  ehrAuthorization?: {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    subject: string;
  };
  patientId: string;
  encounterId?: string;
  userId?: string;
  createdAt: Date;
  lastAccessedAt: Date;
  communicationsSent: number;
  
  // Instance methods
  incrementCommunications(): Promise<void>;
}

// Interface for the model (static methods)
export interface IHookSessionModel extends Model<IHookSession> {
  createFromHook(hook: any, ttlHours?: number): Promise<IHookSession>;
  findActiveSession(patientId: string): Promise<IHookSession | null>;
  cleanupExpired(): Promise<number>;
}

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

// Static method to create a session from a CDS Hook
HookSessionSchema.statics.createFromHook = async function(
  hook: any,
): Promise<IHookSession> {
  const now = new Date();

  let ehrFhirServer = hook.fhirServer?.toString();
  
  const dockerEhrName = process.env.DOCKERED_EHR_CONTAINER_NAME;
  console.log('docker ehr env:' + dockerEhrName)
  if (dockerEhrName) {
    ehrFhirServer = ehrFhirServer
      .replace(/localhost/g, dockerEhrName)
      .replace(/127\.0\.0\.1/g, dockerEhrName);
  }
  
  const session = new this({
    hookInstance: hook.hookInstance,
    hookType: hook.hook,
    ehrFhirServer: ehrFhirServer,
    ehrAuthorization: hook.fhirAuthorization,
    patientId: hook.context.patientId,
    encounterId: hook.context.encounterId,
    userId: hook.context.userId,
    createdAt: now,
    lastAccessedAt: now
  });
  
  await session.save();
  console.log(` Created HookSession: ${session._id} for patient ${session.patientId}`);
  return session;
};

// Static method to find an active session for a patient
HookSessionSchema.statics.findActiveSession = async function(
  patientId: string
): Promise<IHookSession | null> {
  const now = new Date();
  
  // Find the most recent non-expired session for this patient
  const session = await this.findOne({
    patientId: patientId,
  }).sort({ createdAt: -1 }); // Most recent first
  
  if (session) {
    // Update last accessed time
    session.lastAccessedAt = now;
    await session.save();
  }
  
  return session;
};

// Instance method to increment communication counter
HookSessionSchema.methods.incrementCommunications = async function(): Promise<void> {
  this.communicationsSent += 1;
  this.lastAccessedAt = new Date();
  await this.save();
};

export const HookSession = mongoose.model<IHookSession, IHookSessionModel>(
  'HookSession',
  HookSessionSchema
);