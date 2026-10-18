"""Agregação dos routers da API v1."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import auth, health, incidents, meta, users, vehicles

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(meta.router)
api_router.include_router(incidents.router)
api_router.include_router(users.router)
api_router.include_router(vehicles.router)

__all__ = ["api_router"]
