"""The only code in this repo that talks to collegedata.com (plan §2, ADR 0038 R0).

See `fetch.py` (HTTP: rate-limited, self-identifying, robots-respecting) and
`parse.py` (typed parsing of the `pageProps.profile` JSON, no HTML).
"""
