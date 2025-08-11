// Express.js Middleware Examples for Purifai

const express = require('express');
const { Purifai, sanitize, analyze } = require('purifai');

// 1. Basic sanitization middleware
function purifaiMiddleware(options = {}) {
  const config = {
    sanitizeBody: true,
    sanitizeQuery: true,
    sanitizeParams: false,
    logThreats: true,
    ...options
  };

  return (req, res, next) => {
    const startTime = Date.now();
    let threatsDetected = 0;

    // Sanitize request body
    if (config.sanitizeBody && req.body) {
      const result = sanitizeObject(req.body, config);
      req.body = result.sanitized;
      threatsDetected += result.threats;
    }

    // Sanitize query parameters
    if (config.sanitizeQuery && req.query) {
      const result = sanitizeObject(req.query, config);
      req.query = result.sanitized;
      threatsDetected += result.threats;
    }

    // Sanitize URL parameters
    if (config.sanitizeParams && req.params) {
      const result = sanitizeObject(req.params, config);
      req.params = result.sanitized;
      threatsDetected += result.threats;
    }

    // Log threats if enabled
    if (config.logThreats && threatsDetected > 0) {
      console.warn(`🛡️  Purifai: Blocked ${threatsDetected} threats from ${req.ip} on ${req.path}`);
    }

    // Add processing time to headers
    const processingTime = Date.now() - startTime;
    res.set('X-Purifai-Time', `${processingTime}ms`);
    res.set('X-Purifai-Threats', threatsDetected.toString());

    next();
  };
}

// Helper function to sanitize objects recursively
function sanitizeObject(obj, config) {
  let threats = 0;
  const sanitized = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      const analysis = analyze(value);
      sanitized[key] = analysis.content;
      if (analysis.hadThreats) threats++;
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => {
        if (typeof item === 'string') {
          const analysis = analyze(item);
          if (analysis.hadThreats) threats++;
          return analysis.content;
        }
        return item;
      });
    } else if (value && typeof value === 'object') {
      const result = sanitizeObject(value, config);
      sanitized[key] = result.sanitized;
      threats += result.threats;
    } else {
      sanitized[key] = value;
    }
  }

  return { sanitized, threats };
}

// 2. Advanced middleware with threat analysis
function purifaiAnalyzer(options = {}) {
  const config = {
    blockHighThreats: true,
    logAllThreats: true,
    maxThreatsPerRequest: 5,
    ...options
  };

  return (req, res, next) => {
    const threats = [];
    let totalThreats = 0;

    // Analyze all string inputs
    const analyzeInput = (value, source, key) => {
      if (typeof value === 'string' && value.length > 0) {
        const analysis = analyze(value);
        if (analysis.hadThreats) {
          threats.push({
            source,
            key,
            value: value.substring(0, 100), // Truncate for logging
            threatLevel: analysis.threatLevel,
            processingTime: analysis.processingTime
          });
          totalThreats++;
        }
      }
    };

    // Check body
    if (req.body) {
      Object.entries(req.body).forEach(([key, value]) => {
        analyzeInput(value, 'body', key);
      });
    }

    // Check query
    if (req.query) {
      Object.entries(req.query).forEach(([key, value]) => {
        analyzeInput(value, 'query', key);
      });
    }

    // Check if we should block the request
    const criticalThreats = threats.filter(t => t.threatLevel === 'critical').length;
    const highThreats = threats.filter(t => t.threatLevel === 'high').length;

    if (config.blockHighThreats && (criticalThreats > 0 || totalThreats > config.maxThreatsPerRequest)) {
      console.error(`🚨 Purifai: Blocking request from ${req.ip} - ${criticalThreats} critical, ${highThreats} high threats`);
      return res.status(400).json({
        error: 'Request blocked due to security threats',
        code: 'PURIFAI_THREAT_DETECTED',
        details: config.logAllThreats ? threats : 'Contact administrator'
      });
    }

    // Log threats
    if (config.logAllThreats && threats.length > 0) {
      console.warn(`⚠️  Purifai: ${threats.length} threats detected:`, threats);
    }

    // Add threat info to request
    req.purifai = {
      threats,
      totalThreats,
      criticalThreats,
      highThreats
    };

    next();
  };
}

// 3. Example Express application
const app = express();

// Basic setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply Purifai middleware
app.use(purifaiMiddleware({
  sanitizeBody: true,
  sanitizeQuery: true,
  logThreats: true
}));

// Optional: Add threat analyzer for high-security endpoints
app.use('/admin', purifaiAnalyzer({
  blockHighThreats: true,
  maxThreatsPerRequest: 2
}));

// Example routes
app.post('/comments', (req, res) => {
  // req.body is now sanitized
  const { title, content, author } = req.body;
  
  console.log('Received sanitized comment:', {
    title,    // Already sanitized by middleware
    content,  // Already sanitized by middleware
    author    // Already sanitized by middleware
  });

  res.json({
    message: 'Comment received and sanitized',
    purifaiInfo: req.purifai || 'No threats detected'
  });
});

app.get('/search', (req, res) => {
  // req.query is now sanitized
  const { q, category } = req.query;
  
  res.json({
    query: q,        // Already sanitized
    category,        // Already sanitized
    results: `Search results for: ${q}`
  });
});

app.post('/admin/settings', (req, res) => {
  // This route has additional threat analysis
  if (req.purifai && req.purifai.criticalThreats > 0) {
    return res.status(403).json({
      error: 'Access denied due to security threats'
    });
  }

  res.json({
    message: 'Settings updated successfully',
    threats: req.purifai
  });
});

// 4. Custom validation with Purifai
function validateAndSanitize(schema) {
  return (req, res, next) => {
    const errors = [];
    const sanitized = {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      
      if (rules.required && !value) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value) {
        // Check for threats
        const analysis = analyze(value);
        
        if (analysis.hadThreats && rules.blockThreats) {
          errors.push(`${field} contains security threats`);
          continue;
        }

        // Apply length limits
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} exceeds maximum length`);
          continue;
        }

        // Sanitize the value
        sanitized[field] = analysis.content;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    req.body = { ...req.body, ...sanitized };
    next();
  };
}

// Example usage of custom validator
app.post('/profile', 
  validateAndSanitize({
    username: { required: true, maxLength: 50, blockThreats: true },
    bio: { maxLength: 500, blockThreats: true },
    website: { maxLength: 200, blockThreats: true }
  }),
  (req, res) => {
    res.json({
      message: 'Profile updated successfully',
      sanitizedData: req.body
    });
  }
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    purifaiInfo: req.purifai
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🛡️  Server running on port ${PORT} with Purifai protection`);
});

module.exports = {
  purifaiMiddleware,
  purifaiAnalyzer,
  validateAndSanitize,
  sanitizeObject
};