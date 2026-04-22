/**
 * Viewer Routes
 *
 * Handles health check, viewer UI, and SSE stream endpoints.
 * These are used by the web viewer UI at http://localhost:37777
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { logger } from '../../../../utils/logger.js';
import { getPackageRoot } from '../../../../shared/paths.js';
import { SSEBroadcaster } from '../../SSEBroadcaster.js';
import { DatabaseManager } from '../../DatabaseManager.js';
import { SessionManager } from '../../SessionManager.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';

export class ViewerRoutes extends BaseRouteHandler {
  constructor(
    private sseBroadcaster: SSEBroadcaster,
    private dbManager: DatabaseManager,
    private sessionManager: SessionManager
  ) {
    super();
  }

  setupRoutes(app: express.Application): void {
    // Serve static UI assets (JS, CSS, fonts, etc.)
    const packageRoot = getPackageRoot();
    app.use(express.static(path.join(packageRoot, 'ui')));

    app.get('/health', this.handleHealth.bind(this));
    app.get('/', this.handleViewerUI.bind(this));
    app.get('/stream', this.handleSSEStream.bind(this));
    app.get('/api/ticks', this.handleGetTicks.bind(this));
    app.get('/ticks', this.handleTicksUI.bind(this));
    app.get('/admin', this.handleAdminUI.bind(this));
    app.get('/graph', this.handleGraphUI.bind(this));
  }

  /**
   * Health check endpoint
   */
  private handleHealth = this.wrapHandler((req: Request, res: Response): void => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  /**
   * Serve viewer UI
   */
  private handleViewerUI = this.wrapHandler((req: Request, res: Response): void => {
    const packageRoot = getPackageRoot();

    // Try cache structure first (ui/sessions.html), then marketplace structure (plugin/ui/sessions.html)
    const viewerPaths = [
      path.join(packageRoot, 'ui', 'sessions.html'),
      path.join(packageRoot, 'plugin', 'ui', 'sessions.html')
    ];

    const viewerPath = viewerPaths.find(p => existsSync(p));

    if (!viewerPath) {
      throw new Error('Sessions UI not found at any expected location');
    }

    const html = readFileSync(viewerPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  /**
   * SSE stream endpoint
   */
  private handleSSEStream = this.wrapHandler((req: Request, res: Response): void => {
    // Guard: if DB is not yet initialized, return 503 before registering client
    try {
      this.dbManager.getSessionStore();
    } catch {
      res.status(503).json({ error: 'Service initializing' });
      return;
    }

    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Add client to broadcaster
    this.sseBroadcaster.addClient(res);

    // Send initial_load event with project/source catalog
    const projectCatalog = this.dbManager.getSessionStore().getProjectCatalog();
    this.sseBroadcaster.broadcast({
      type: 'initial_load',
      projects: projectCatalog.projects,
      sources: projectCatalog.sources,
      projectsBySource: projectCatalog.projectsBySource,
      timestamp: Date.now()
    });

    // Send initial processing status (based on queue depth + active generators)
    const isProcessing = this.sessionManager.isAnySessionProcessing();
    const queueDepth = this.sessionManager.getTotalActiveWork(); // Includes queued + actively processing
    this.sseBroadcaster.broadcast({
      type: 'processing_status',
      isProcessing,
      queueDepth
    });
  });

  /**
   * Get tick log endpoint
   */
  private handleGetTicks = this.wrapHandler((req: Request, res: Response): void => {
    let store;
    try {
      store = this.dbManager.getSessionStore();
    } catch {
      res.status(503).json({ error: 'Service initializing' });
      return;
    }
    const limitParam = parseInt(String(req.query.limit ?? '100'), 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;
    const ticks = store.getTickLog(limit);
    res.json({ ticks, fetchedAt: new Date().toISOString() });
  });

  /**
   * Serve ticks UI
   */
  private handleTicksUI = this.wrapHandler((req: Request, res: Response): void => {
    const packageRoot = getPackageRoot();
    const candidates = [
      path.join(packageRoot, 'ui', 'ticks.html'),
      path.join(packageRoot, 'plugin', 'ui', 'ticks.html'),
    ];
    const ticksPath = candidates.find(p => existsSync(p));
    if (!ticksPath) {
      throw new Error('Ticks UI not found — run npm run build-and-sync');
    }
    const html = readFileSync(ticksPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  /**
   * Serve graph UI
   */
  private handleGraphUI = this.wrapHandler((_req: Request, res: Response): void => {
    const packageRoot = getPackageRoot();
    const candidatePaths = [
      path.join(packageRoot, 'ui', 'graph.html'),
      path.join(packageRoot, 'plugin', 'ui', 'graph.html'),
    ];
    const htmlPath = candidatePaths.find((p) => existsSync(p));
    if (!htmlPath) throw new Error('Graph UI not found — run npm run build-and-sync');
    const html = readFileSync(htmlPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  /**
   * Serve admin UI
   */
  private handleAdminUI = this.wrapHandler((req: Request, res: Response): void => {
    const packageRoot = getPackageRoot();
    const candidates = [
      path.join(packageRoot, 'ui', 'admin.html'),
      path.join(packageRoot, 'plugin', 'ui', 'admin.html'),
    ];
    const adminPath = candidates.find(p => existsSync(p));
    if (!adminPath) {
      throw new Error('Admin UI not found — run npm run build-and-sync');
    }
    const html = readFileSync(adminPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
}
