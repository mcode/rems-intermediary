import mongoose from 'mongoose';
const { Schema } = mongoose;

const ConnectionSchema = new Schema({
  to: {
    type: String,
    required: true
  },
  toEtasu: {
    type: String,
    required: true
  },
  from: [{
    type: String,
    required: true
  }],
  code: {
    type: String,
    required: true
  },
  system: {
    type: String,
    required: true
  },
});

export const Connection = mongoose.model('Connection', ConnectionSchema);
