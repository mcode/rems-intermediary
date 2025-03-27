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
  from: [
    {
      type: String,
      required: true
    }
  ],
  code: {
    type: String,
    required: true
  },
  system: {
    type: String,
    required: true
  },
  brand_name: {
    type: String,
    required: true
  },
  generic_name: {
    type: String,
    required: false
  },
  directoryLookupType: {
    type: String,
    required: false
  },
  rems_spl_date: {
    type: String,
    required: false
  }
});

export const Connection = mongoose.model('Connection', ConnectionSchema);
