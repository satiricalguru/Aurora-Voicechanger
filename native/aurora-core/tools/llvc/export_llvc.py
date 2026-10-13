"""
Export LLVC (https://github.com/KoeAI/LLVC, MIT) to the Aurora streaming-model
format: one ONNX graph per 13 ms step, [context | chunk] + state in ->
chunk + state out, with aurora.* metadata.

    git clone https://github.com/KoeAI/LLVC
    curl -L -o G_500000.pth https://huggingface.co/KoeAI/llvc/resolve/main/models/checkpoints/llvc/G_500000.pth
    python export_llvc.py --llvc-src LLVC --checkpoint G_500000.pth --out ../../../../models/llvc/llvc.onnx

Needs torch and onnx. The checkpoint is loaded with weights_only=True.
"""
import argparse
import json
import os
import sys

import numpy as np
import torch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--llvc-src', required=True, help='LLVC repository checkout')
    ap.add_argument('--checkpoint', required=True, help='G_500000.pth')
    ap.add_argument('--out', required=True, help='output .onnx path')
    ap.add_argument('--chunk-factor', type=int, default=1, help='chunks of 13 ms per step')
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    # LLVC imports speechbrain only for a sinusoidal positional encoding.
    sys.path.insert(0, os.path.join(here, 'shim'))
    sys.path.insert(0, os.path.abspath(args.llvc_src))
    from model import Net  # noqa: E402

    cfg = json.load(open(os.path.join(args.llvc_src, 'experiments', 'llvc', 'config.json')))
    net = Net(**cfg['model_params'])
    net.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=True)['model'])
    net.eval()
    sr = cfg['data']['sr']
    L = net.L
    chunk = net.dec_chunk_size * L * args.chunk_factor

    class Step(torch.nn.Module):
        def __init__(self, n):
            super().__init__()
            self.n = n

        def forward(self, audio, enc_buf, dec_buf, out_buf, convnet_ctx):
            return self.n(audio, enc_buf.clone(), dec_buf.clone(), out_buf.clone(), convnet_ctx.clone(), pad=False)

    enc, dec, out = net.init_buffers(1, torch.device('cpu'))
    ctx = net.convnet_pre.init_ctx_buf(1, torch.device('cpu'))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    torch.onnx.export(Step(net).eval(), (torch.zeros(1, 1, chunk + 2 * L), enc, dec, out, ctx), args.out,
                      dynamo=False, opset_version=17,
                      input_names=['audio', 'enc_buf', 'dec_buf', 'out_buf', 'convnet_ctx'],
                      output_names=['out', 'enc_buf_out', 'dec_buf_out', 'out_buf_out', 'convnet_ctx_out'])

    import onnx
    model = onnx.load(args.out)
    for k, v in {'aurora.sample_rate': sr, 'aurora.lookahead': L, 'aurora.source': 'KoeAI/LLVC G_500000 (MIT)',
                 'aurora.target': 'LibriSpeech speaker 8312'}.items():
        p = model.metadata_props.add()
        p.key, p.value = k, str(v)
    onnx.save(model, args.out)
    print(f'wrote {args.out} ({os.path.getsize(args.out) // 1024} KB): {sr} Hz, chunk {chunk}, context {2 * L}, lookahead {L}')


if __name__ == '__main__':
    main()
