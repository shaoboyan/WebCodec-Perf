/*
Copyright (c) 2020 The Khronos Group Inc.
Use of this source code is governed by an MIT-style license that can be
found in the LICENSE.txt file.
*/

const wgslShaders = {
    vertex: `#version 450
  [[location(0)]] var<in> position : vec3<f32>;
  [[location(1)]] var<in> uv : vec2<f32>;
  [[location(0)]] var<out> fragUV : vec2<f32>;
  [[builtin(position)]] var<out> Position : vec4<f32>;
  [[stage(vertex)]]
  fn main() -> void {
     Position = vec4<f32>(position, 1.0);
     fragUV = uv;
  }
  `,
  
    fragment: `
  [[binding(0), set(0)]] var<uniform_constant> mySampler: sampler;
  [[binding(1), set(0)]] var<uniform_constant> myTexture: texture_sampled_2d<f32>;
  [[location(0)]] var<in> fragUV : vec2<f32>;
  [[location(0)]] var<out> outColor : vec4<f32>;
  [[stage(fragment)]]
  fn main() -> void {
    outColor = textureSample(myTexture, mySampler, fragUV);
    return;
  }
  `,
  
  };

// No float literal scientific notation support in wgsl.
const wgslImportShaders = {
    vertex: `#version 450
  [[location(0)]] var<in> position : vec3<f32>;
  [[location(1)]] var<in> uv : vec2<f32>;
  [[location(0)]] var<out> fragUV : vec2<f32>;
  [[builtin(position)]] var<out> Position : vec4<f32>;
  [[stage(vertex)]]
  fn main() -> void {
     Position = vec4<f32>(position, 1.0);
     fragUV = uv;
  }
  `,
  
    fragment: `
  [[binding(0), set(0)]] var<uniform_constant> mySamplerPlane0: sampler;
  [[binding(1), set(0)]] var<uniform_constant> myTexturePlane0: texture_sampled_2d<f32>;
  [[binding(2), set(0)]] var<uniform_constant> mySamplerPlane1: sampler;
  [[binding(3), set(0)]] var<uniform_constant> myTexturePlane1: texture_sampled_2d<f32>;
  [[location(0)]] var<in> fragUV : vec2<f32>;
  [[location(0)]] var<out> outColor : vec4<f32>;
  [[stage(fragment)]]
  fn main() -> void {
    var plane0 : vec4<f32> = textureSample(myTexturePlane0, mySamplerPlane0, fragUV);
    var plane1 : vec4<f32> = textureSample(myTexturePlane1, mySamplerPlane1, fragUV);
    var interPixel : vec3<f32> = vec3<f32>(plane0[0], plane1[0], plane1[1]);

    var factorOne : vec3<f32> = vec3<f32>(1.16438353, 1.16438353, 1.16438353);
    var factorTow : vec3<f32> = vec3<f32>(-0.00000000228029018, -0.213248596, 2.11240172);
    var factorThree: vec3<f32> = vec3<f32>(1.79274118, -0.532909274, -0.000000000596049432);

    interPixel = vec3<f32>(factorOne * interPixel, factorTow * interPixel, factorThree * interPixel);
    interPixel = vec3<f32>(-0.969429970, 0.300019622, -1.12926030) + interPixel;
    outColor = vec4<f32>(interPixel, 1.0);
    return;
  }
  `,
  
  };


async function requestWebGPUVideoFrameHandler(canvas, stat, renderingMethod) {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext('gpupresent');
  let ready_frames = [];
  let stats = stat;
  const useImport = (renderingMethod === 4);

  const swapChainFormat = "bgra8unorm";

  const rectVerts = new Float32Array([
    1.0,  1.0, 0.0, 1.0, 0.0,
    1.0, -1.0, 0.0, 1.0, 1.0,
    -1.0, -1.0, 0.0, 0.0, 1.0,
    1.0,  1.0, 0.0, 1.0, 0.0,
    -1.0, -1.0, 0.0, 0.0, 1.0,
    -1.0,  1.0, 0.0, 0.0, 0.0,
  ]);

  const verticesBuffer = device.createBuffer({
    size: rectVerts.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(verticesBuffer.getMappedRange()).set(rectVerts);
  verticesBuffer.unmap();

  const swapChain = context.configureSwapChain({
    device,
    format: swapChainFormat,
  });

  const pipeline = device.createRenderPipeline({
    vertexStage: {
      module: device.createShaderModule({
        code: useImport ? wgslImportShaders.vertex : wgslShaders.vertex,
      }),
      entryPoint: "main"
    },
    fragmentStage: {
      module: device.createShaderModule({
        code: useImport ? wgslImportShaders.fragment : wgslShaders.fragment,
      }),
      entryPoint: "main"
    },

    primitiveTopology: "triangle-list",
    vertexState: {
      vertexBuffers: [{
        arrayStride: 20,
        attributes: [{
          // position
          shaderLocation: 0,
          offset: 0,
          format: "float3"
        }, {
          // uv
          shaderLocation: 1,
          offset: 12,
          format: "float2"
        }]
      }],
    },

    colorStates: [{
      format: swapChainFormat,
    }],
  });

  // This is the default sampler and the same as
  // samplerPlane0.
  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  const samplerPlane1 = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  let videoTexture = null;

  let uniformBindGroup = null; 
  
  async function renderFrameImageBitmap() {
    if (ready_frames.length == 0) {
        return;
    }
    
    const frame = ready_frames.shift();
    if (videoTexture === null && !useImport) {
      videoTexture = device.createTexture({
            size: {
              width: frame.codedWidth,
              height: frame.codedHeight,
              depth: 1,
            },
            format: 'rgba8unorm',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED,
        });
    }

    if (uniformBindGroup === null && !useImport) {
        uniformBindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{
              binding: 0,
              resource: sampler,
            }, {
              binding: 1,
              resource: videoTexture.createView(),
            }],
        });
    }

    stats.begin();
    let videoFrame;
    let videoFramePlane0;
    let videoFramePlane1;
    if (useImport) {
      videoFramePlane0 = device.defaultQueue.importVideoFrame(frame, 0);
      videoFramePlane1 = device.defaultQueue.importVideoFrame(frame, 1);
      uniformBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: sampler,
        }, {
          binding: 1,
          resource: videoFramePlane0,
        }, {
          binding: 2,
          resource: samplerPlane1,
        }, {
          binding: 3,
          resource: videoFramePlane1,
        }],
      });
    } else {
      videoFrame = await frame.createImageBitmap();
      device.defaultQueue.copyImageBitmapToTexture(
        {imageBitmap:videoFrame, origin: {x:0, y: 0} },
        {texture: videoTexture},
        {width: frame.codedWidth, height:frame.codedHeight, depth: 1}
      );
    }

    const commandEncoder = device.createCommandEncoder();
    const textureView = swapChain.getCurrentTexture().createView();

    const renderPassDescriptor = {
      colorAttachments: [{
        attachment: textureView,
        loadValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
      }],
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setVertexBuffer(0, verticesBuffer);
    passEncoder.setBindGroup(0, uniformBindGroup);
    passEncoder.draw(6, 1, 0, 0);
    passEncoder.endPass();
    device.defaultQueue.submit([commandEncoder.finish()]);
    if (useImport) {
      device.defaultQueue.releaseVideoFrame(frame);
    }
    if (!useImport) {
        videoFrame.close();
    }
    frame.destroy();
    stats.end();
  }

  function handleFrame(frame) {
    ready_frames.push(frame);
    if (useImport) {
        setTimeout(renderFrameImageBitmap, 0);
    } else {
        setTimeout(renderFrameImageBitmap, 0);
    }
  }
  
  return handleFrame;
}
