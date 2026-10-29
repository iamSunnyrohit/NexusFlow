import mongoose from 'mongoose';

const auditSchema = new mongoose.Schema(
  {
    userId: mongoose.Schema.Types.ObjectId,
    action: { type: String, required: true }, 
    target: String,
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLog = mongoose.model('AuditLog', auditSchema);

export const audit = (userId, action, target, meta) =>
  AuditLog.create({ userId, action, target, meta }).catch(() => {});
